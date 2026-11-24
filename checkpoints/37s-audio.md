# 37s — Soft wrong-move sound (contract 37, stage B)

Date: 2026-11-24, branch feat/user-account, base commit e32fa75.

Old file backed up at `checkpoints/37s-old-wrong-sound.mp3`.

## New file
`src/public/audio/wrong_move_sound.mp3` — regenerated, same filename.
- Synthesis: 180 Hz -> 140 Hz sine sweep, 150 ms (aevalsrc f(t) = 180 - 133.333*t).
- Chain: afade in 15 ms, afade out 60 ms (st=0.09), lowpass 400 Hz, gain to ~-20 dBFS peak (volume=0.125).
- Encode: libmp3lame, 128k, mono, 44.1 kHz (matches sibling audio files; brief said "~64k mono", repo files are 128k).

## volumedetect
| | max_volume | mean_volume |
|---|---|---|
| before | 0.0 dB | -8.9 dB |
| after (mp3) | -20.5 dB | -25.3 dB |

Target: max around -18..-22 dBFS -> met.

## JS
`src/public/js/game.js`: `wrong_move_sound.volume = 0.35;` added after the Audio constructions (node --check OK).
