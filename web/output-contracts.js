// Fixed board contracts, shared by compiler validation and browser scheduling.
// Rates describe simulated time; wall-clock timers only request bounded batches.
export const boards = {
  snes: {
    top: "snes", clockHz: 21477270, batchCycles: 16384,
    width: 512, height: 480, sampleRate: 32000,
    ports: {
      cart_write: ["input", 1], cart_address: ["input", 22], cart_data: ["input", 8],
      cart_hirom: ["input", 1], cart_mask: ["input", 22], buttons: ["input", 12],
      cart_ram_size: ["input", 4],
      ready: ["output", 1],
      video_valid: ["output", 1], video_x: ["output", 9], video_y: ["output", 9],
      video_height: ["output", 9],
      video_rgb: ["output", 24], video_last: ["output", 1],
      audio_valid: ["output", 1], audio_sample: ["output", 16, true],
      trace_address: ["output", 24], trace_data: ["output", 8], trace_flags: ["output", 4],
    },
  },
  counter: {
    top: "counter", clockHz: 10, batchCycles: 1,
    ports: { count: ["output", 8] },
  },
  cpu816: {
    top: "cpu816_test", clockHz: 10000, batchCycles: 256,
    ports: {
      result: ["output", 8], trace_address: ["output", 24],
      trace_data: ["output", 8], trace_flags: ["output", 4],
    },
  },
  video: {
    top: "video", clockHz: 184320, batchCycles: 3072, width: 64, height: 48,
    ports: {
      video_valid: ["output", 1], video_x: ["output", 6], video_y: ["output", 6],
      video_rgb: ["output", 24], video_last: ["output", 1],
    },
  },
  audio: {
    top: "audio", clockHz: 48000, batchCycles: 3072, sampleRate: 8000,
    ports: { audio_valid: ["output", 1], audio_sample: ["output", 16, true] },
  },
};
