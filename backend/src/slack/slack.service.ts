import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';

const TRIGGER_KEYWORDS = ['bug', 'issue', 'error', 'broken'];
const BUG_EMOJI = ':bug:';

export interface SlackMessageEvent {
  type: string;
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  message?: {
    text?: string;
    user?: string;
    bot_id?: string;
  };
}

export interface SlackEventPayload {
  token: string;
  team_id: string;
  api_app_id: string;
  event: SlackMessageEvent;
  type: 'event_callback';
  event_id: string;
  event_time: number;
}

@Injectable()
export class SlackService {
  private readonly signingSecret: string;
  private readonly channelId: string;
  private readonly botToken: string;
  private readonly processThreads: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    @InjectQueue('ticket') private readonly ticketQueue: Queue,
  ) {
    this.signingSecret = this.config.get<string>('SLACK_SIGNING_SECRET') ?? '';
    this.channelId = this.config.get<string>('CHANNEL_ID') ?? '';
    this.botToken = this.config.get<string>('SLACK_BOT_TOKEN') ?? '';
    this.processThreads = this.config.get<string>('PROCESS_THREADS') === 'true';
  }

  verifySignature(rawBody: Buffer, signature: string, timestamp: string): boolean {
    if (!this.signingSecret) {
      this.logger.warn('SLACK_SIGNING_SECRET is not set', 'SlackService');
      return false;
    }
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (parseInt(timestamp, 10) < fiveMinutesAgo) {
      this.logger.warn('Slack request timestamp too old', 'SlackService');
      return false;
    }
    const sigBasestring = `v0:${timestamp}:${rawBody.toString('utf8')}`;
    const hmac = createHmac('sha256', this.signingSecret);
    hmac.update(sigBasestring);
    const mySig = 'v0=' + hmac.digest('hex');
    try {
      return timingSafeEqual(Buffer.from(mySig, 'utf8'), Buffer.from(signature, 'utf8'));
    } catch {
      return false;
    }
  }

  isFromConfiguredChannel(channelId: string): boolean {
    return this.channelId !== '' && channelId === this.channelId;
  }

  isBotMessage(event: SlackMessageEvent): boolean {
    if (event.bot_id) return true;
    if (event.message?.bot_id) return true;
    return false;
  }

  shouldProcessThread(event: SlackMessageEvent): boolean {
    if (!event.thread_ts) return true;
    return this.processThreads;
  }

  getMessageText(event: SlackMessageEvent): string {
    const text = event.text ?? event.message?.text ?? '';
    return this.cleanText(String(text).trim());
  }

  cleanText(text: string): string {
    return text
      .replace(/<http[^|>]*\|([^>]+)>/g, '$1')  // <http://url|label> -> label
      .replace(/<http[^>]+>/g, '')               // <http://url> -> remove
      .replace(/<@[A-Z0-9]+>/g, '')              // <@USER> -> remove
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1') // <#CHAN|name> -> #name
      .replace(/<![^>]+>/g, '')                  // <!here>, <!channel> -> remove
      .replace(/\s{2,}/g, ' ')                   // collapse extra spaces
      .trim();
  }

  hasTrigger(text: string, hasBugEmoji?: boolean): boolean {
    const lower = text.toLowerCase();
    if (hasBugEmoji) return true;
    return TRIGGER_KEYWORDS.some((kw) => {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      return re.test(lower);
    });
  }

  async isAlreadyProcessed(messageId: string): Promise<boolean> {
    const found = await this.prisma.processedMessage.findUnique({
      where: { messageId },
    });
    return !!found;
  }

  async markProcessed(messageId: string, channelId: string, ts: string): Promise<void> {
    await this.prisma.processedMessage.upsert({
      where: { messageId },
      create: { messageId, channelId, ts },
      update: {},
    });
  }

  async enqueueTicketJob(payload: {
    eventId: string;
    channelId: string;
    userId: string | undefined;
    text: string;
    ts: string;
    threadTs: string | undefined;
    permalink: string;
    hasBugEmoji: boolean;
    files?: { name: string; url_private: string; mimetype: string; permalink: string }[];
    attachments?: { title?: string; title_link?: string; text?: string; image_url?: string }[];
  }): Promise<void> {
    await this.ticketQueue.add('create-or-comment', payload, {
      jobId: payload.eventId,
      removeOnComplete: { age: 86400 },
    });
    this.logger.log(
      { eventId: payload.eventId, channelId: payload.channelId },
      'Enqueued ticket job',
    );
  }

  async addReaction(channel: string, ts: string, emoji: string): Promise<void> {
    if (!this.botToken) return;
    try {
      const axios = (await import('axios')).default;
      await axios.post(
        'https://slack.com/api/reactions.add',
        { channel, timestamp: ts, name: emoji.replace(/:/g, '') },
        { headers: { Authorization: `Bearer ${this.botToken}` } },
      );
    } catch (err) {
      this.logger.warn({ err, channel, ts }, 'Failed to add Slack reaction');
    }
  }

  async postReply(channel: string, threadTs: string, text: string): Promise<void> {
    if (!this.botToken) return;
    try {
      const axios = (await import('axios')).default;
      await axios.post(
        'https://slack.com/api/chat.postMessage',
        { channel, thread_ts: threadTs, text },
        { headers: { Authorization: `Bearer ${this.botToken}` } },
      );
    } catch (err) {
      this.logger.warn({ err, channel, threadTs }, 'Failed to post Slack reply');
    }
  }

  async getPermalink(channel: string, ts: string): Promise<string> {
    if (!this.botToken) {
      return `https://slack.com/archives/${channel}/p${ts.replace('.', '')}`;
    }
    try {
      const axios = (await import('axios')).default;
      const res = await axios.get('https://slack.com/api/chat.getPermalink', {
        params: { channel, message_ts: ts },
        headers: { Authorization: `Bearer ${this.botToken}` },
      });
      return res.data?.permalink ?? `https://slack.com/archives/${channel}/p${ts.replace('.', '')}`;
    } catch {
      return `https://slack.com/archives/${channel}/p${ts.replace('.', '')}`;
    }
  }
}
