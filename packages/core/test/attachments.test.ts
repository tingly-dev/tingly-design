import { describe, expect, it } from 'vitest';
import {
  ATTACH_LIMITS,
  attachmentBlocks,
  attachmentFileName,
  attachmentKind,
  base64Bytes,
  buildFastEditPrompt,
  checkAttachments,
  checkMessages,
  type Attachment,
} from '../src';

const png: Attachment = { name: 'shot.png', kind: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' };
const pdf: Attachment = { name: 'brief.pdf', kind: 'pdf', mediaType: 'application/pdf', data: 'JVBERi0=' };
const csv: Attachment = { name: 'q3.csv', kind: 'text', mediaType: 'text/csv', data: 'month,calls\nJul,120\n' };

describe('attachments', () => {
  it('knows images, PDFs and text files by name or type, and nothing else', () => {
    expect(attachmentKind('a.PNG')).toEqual({ kind: 'image', mediaType: 'image/png' });
    expect(attachmentKind('image', 'image/webp')).toEqual({ kind: 'image', mediaType: 'image/webp' });
    expect(attachmentKind('logo.svg')?.kind).toBe('text');
    expect(attachmentKind('brief.pdf')?.kind).toBe('pdf');
    expect(attachmentKind('notes', 'text/plain')?.kind).toBe('text');
    expect(attachmentKind('a.zip', 'application/zip')).toBeNull();
    expect(attachmentKind('a.heic', 'image/heic')).toBeNull();
  });

  it('measures base64 the way it decodes', () => {
    expect(base64Bytes(btoa('abcd'))).toBe(4);
    expect(base64Bytes(btoa('abcde'))).toBe(5);
    expect(base64Bytes(btoa('abcdef'))).toBe(6);
  });

  it('accepts a good set and refuses too many, too big, unknown or mislabelled files', () => {
    expect(checkAttachments(undefined)).toBeNull();
    expect(checkAttachments([png, pdf, csv])).toBeNull();
    expect(checkAttachments(Array(ATTACH_LIMITS.count + 1).fill(csv))).toMatch(/at most/);
    expect(checkAttachments([{ ...png, data: 'A'.repeat(Math.ceil((ATTACH_LIMITS.imageBytes * 4) / 3) + 8) }])).toMatch(/5 MB/);
    expect(checkAttachments([{ ...csv, data: 'x'.repeat(ATTACH_LIMITS.textChars + 1) }])).toMatch(/characters/);
    expect(checkAttachments([{ ...png, name: 'a.zip', mediaType: 'application/zip' }])).toMatch(/cannot attach/);
    expect(checkAttachments([{ ...csv, kind: 'image' }])).toMatch(/cannot attach/);
    expect(checkAttachments([{ ...png, data: 'not base64!' }])).toMatch(/base64/);
    expect(checkAttachments('x')).toMatch(/list/);
  });

  it('names files safely and keeps them apart', () => {
    expect(attachmentFileName('../../etc/passwd', 0)).toBe('1-passwd');
    expect(attachmentFileName('截图 2026.png', 1)).toBe('2-2026.png');
    expect(attachmentFileName('.png', 2)).toBe('3-file.png');
  });

  it('becomes labelled content blocks, text fenced as untrusted', () => {
    const b = attachmentBlocks([png, pdf, csv], 'n0');
    expect(b.map((x) => x.type)).toEqual(['text', 'image', 'document', 'text']);
    expect(b[0]).toEqual({ type: 'text', text: 'attachment 1: shot.png' });
    expect(b[1]).toMatchObject({ source: { type: 'base64', media_type: 'image/png', data: png.data } });
    expect(b[2]).toMatchObject({ title: 'brief.pdf', source: { media_type: 'application/pdf' } });
    expect((b[3] as { text: string }).text).toBe('attachment 3: q3.csv\n⟦untrusted:n0⟧\nmonth,calls\nJul,120\n\n⟦/untrusted:n0⟧');
  });

  it('is named in the fast-edit prompt only when there is something attached', () => {
    const base = { file: 'A.dc.html', markup: '<div id="dc0"></div>', journal: [], prompt: 'match this', nonce: 'n0' };
    expect(buildFastEditPrompt(base)).not.toContain('attached');
    expect(buildFastEditPrompt({ ...base, attachments: '- attachment 1: shot.png (image)' })).toContain('attached (shown above this message)\n⟦untrusted:n0⟧\n- attachment 1: shot.png (image)');
  });

  it('lets only text, image and PDF blocks through to the model', () => {
    const user = (content: unknown) => [{ role: 'user', content }];
    expect(checkMessages(user('hi'))).toBeNull();
    expect(checkMessages(user([...attachmentBlocks([png, pdf, csv], 'n'), { type: 'text', text: 'go' }]))).toBeNull();
    expect(checkMessages([])).toMatch(/missing/);
    expect(checkMessages([{ role: 'system', content: 'x' }])).toMatch(/bad message/);
    expect(checkMessages([{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }])).toMatch(/bad message/);
    expect(checkMessages(user([{ type: 'tool_use', id: 'x', name: 'y', input: {} }]))).toMatch(/bad/);
    expect(checkMessages(user([{ type: 'image', source: { type: 'url', url: 'http://x' } }]))).toMatch(/bad attachment/);
    expect(checkMessages(user([{ type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: '' } }]))).toMatch(/svg/);
    expect(checkMessages(user([{ type: 'document', source: { type: 'base64', media_type: 'text/plain', data: '' } }]))).toMatch(/PDF/);
    expect(checkMessages(user(attachmentBlocks(Array(ATTACH_LIMITS.count + 1).fill(png), 'n')))).toMatch(/at most/);
  });
});
