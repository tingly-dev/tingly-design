import { describe, expect, it } from 'vitest';
import {
  ATTACH_LIMITS,
  attachmentBlocks,
  attachmentKind,
  attachmentSummary,
  base64Bytes,
  buildFastEditPrompt,
  checkMessages,
  checkUploads,
  isKeptPath,
  isUploadPath,
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

  it('keeps attachments only in uploads/, of a kind that can be attached', () => {
    expect(isUploadPath('uploads/shot-1a2b3c4d.png')).toBe(true);
    expect(isUploadPath('uploads/q3-1a2b3c4d.csv')).toBe(true);
    expect(isUploadPath('uploads/a.zip')).toBe(false);
  });
  it('keeps an imported folder with its own tree under uploads/', () => {
    expect(isKeptPath('uploads/site-1a2b3c4d/index.html')).toBe(true);
    expect(isKeptPath('uploads/site-1a2b3c4d/fonts/Inter Var.woff2')).toBe(true);
    expect(isKeptPath('uploads/官网-1a2b3c4d/图片/头图.png')).toBe(true);
    expect(isKeptPath('uploads/site/../canvas.json')).toBe(false);
    expect(isKeptPath('uploads/site/.env')).toBe(false);
    expect(isKeptPath('uploads/site/app.exe')).toBe(false);
    expect(isKeptPath('assets/x.png')).toBe(false);
    expect(isUploadPath('uploads/../canvas.json')).toBe(false);
    expect(isUploadPath('uploads/sub/a.png')).toBe(false);
    expect(isUploadPath('assets/a.png')).toBe(false);
  });

  it('hands on a good list of kept attachments and refuses anything else', () => {
    const kept = { name: 'shot.png', path: 'uploads/shot-1a2b3c4d.png' };
    expect(checkUploads(undefined)).toBeNull();
    expect(checkUploads([kept])).toBeNull();
    expect(checkUploads(Array(ATTACH_LIMITS.count + 1).fill(kept))).toMatch(/at most/);
    expect(checkUploads([{ ...kept, path: '../../etc/passwd' }])).toMatch(/not an upload/);
    expect(checkUploads([{ name: 'x' }])).toMatch(/bad/);
    expect(checkUploads('x')).toMatch(/list/);
  });

  it('becomes labelled content blocks, text fenced as untrusted', () => {
    const b = attachmentBlocks([png, pdf, csv], 'n0');
    expect(b.map((x) => x.type)).toEqual(['text', 'image', 'document', 'text']);
    expect(b[0]).toEqual({ type: 'text', text: 'attachment 1: shot.png' });
    expect(attachmentBlocks([{ ...png, path: 'uploads/shot-1a2b3c4d.png' }], 'n0')[0]).toEqual({
      type: 'text',
      text: 'attachment 1: shot.png, kept in the project as uploads/shot-1a2b3c4d.png',
    });
    expect(attachmentSummary([{ ...csv, path: 'uploads/q3-1a2b3c4d.csv' }])).toBe('- attachment 1: q3.csv (text), kept as uploads/q3-1a2b3c4d.csv');
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
