import { afterEach, describe, expect, it, vi } from 'vitest';

/** A browser whose encoders accept only these codec prefixes. */
function browser(video: string[], audio: string[]) {
  vi.stubGlobal('VideoFrame', class {});
  vi.stubGlobal('VideoEncoder', { isConfigSupported: async (c: { codec: string }) => ({ supported: video.some((p) => c.codec.startsWith(p)), config: c }) });
  vi.stubGlobal('AudioEncoder', { isConfigSupported: async (c: { codec: string }) => ({ supported: audio.some((p) => c.codec.startsWith(p)), config: c }) });
}

afterEach(() => vi.unstubAllGlobals());

/** mediabunny remembers what each codec could do, so every test loads it afresh. */
async function plan(o: Parameters<typeof import('../src/capabilities').planVideo>[0]) {
  vi.resetModules();
  return (await import('../src/capabilities')).planVideo(o);
}

describe('planVideo', () => {
  it('has no plan without WebCodecs', async () => {
    expect(await plan({ width: 1280, height: 720 })).toBeNull();
  });

  it('writes MP4 where H.264 and AAC encode', async () => {
    browser(['avc1', 'vp09'], ['mp4a', 'opus']);
    expect(await plan({ width: 1280, height: 720 })).toMatchObject({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac' });
  });

  it('falls back to WebM and says it is for want of H.264', async () => {
    browser(['vp09', 'vp8'], ['opus']);
    expect(await plan({ width: 1280, height: 720 })).toMatchObject({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', note: 'no-h264' });
  });

  it('falls back to WebM when AAC is missing, since every video carries a track', async () => {
    browser(['avc1', 'vp09'], ['opus']);
    expect(await plan({ width: 1280, height: 720 })).toMatchObject({ container: 'webm', note: 'no-aac' });
  });

  it('gives WebM without a note when WebM is what was asked for', async () => {
    browser(['avc1', 'vp09'], ['mp4a', 'opus']);
    expect(await plan({ width: 1280, height: 720, format: 'webm' })).toMatchObject({ container: 'webm' });
  });
});

describe('silentChunks', () => {
  it('adds up to the length of the video, a second at a time', async () => {
    const { silentChunks } = await import('../src/audio');
    expect(silentChunks(2.5, 48000)).toEqual([48000, 48000, 24000]);
    expect(silentChunks(0, 48000).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
