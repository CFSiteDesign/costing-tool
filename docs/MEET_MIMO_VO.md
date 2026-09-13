# Meet MIMO video: voice-over timing

The video (`Meet MIMO.mp4`, 75s, 1920x1080, no audio track) has burned-in captions. Each caption's on-screen
window was measured from the file, so each voice line below has a start time and a maximum length.

## Timed script

| # | Start | Window | Max clip | Line (paste into ElevenLabs as written) |
|---|---|---|---|---|
| 01 | 0.8s | 0.0 to 8.0 | 7.0s | This is Meemo. She looks after the experiences at your hostel. |
| 02 | 8.4s | 8.25 to 15.0 | 6.4s | Changing a price used to mean a form, a spreadsheet, and a message to someone else. |
| 03 | 15.7s | 15.5 to 19.0 | 3.1s | Now you just tell Meemo. |
| 04 | 22.4s | 22.25 to 27.5 | 4.9s | Type it the way you'd say it. Typos and nicknames are fine. |
| 05 | 28.4s | 28.25 to 35.25 | 6.6s | She shows you exactly what will change, and nothing moves until you confirm. |
| 06 | 38.9s | 38.75 to 47.25 | 8.1s | Ask her anything about your list. Tonight, tomorrow, prices, days, limits. |
| 07 | 50.9s | 50.75 to 57.25 | 6.1s | She never acts alone, she never deletes, and she only sees your hostel. |
| 08 | 58.9s | 58.75 to 63.5 | 4.4s | Big changes get a second check. |
| 09 | 64.6s | 64.5 to 67.25 | 3.2s | She learns the names your team uses. |
| 10 | 67.9s | 67.75 to 72.5 | 4.5s | Find her bottom left, or press Command K. Say good morning. |

"Meemo" is spelt that way only so the voice says it right (MEE-mo). The captions still say MIMO.

Tight ones: 09 has under three seconds, 04 and 10 have little slack. If a clip comes back longer than its
max, first try ElevenLabs speed 1.05 to 1.1 on that line, then shorten the copy (09: "She learns your
team's names." 10: "Find her bottom left, or press Command K.").

The gaps with no caption (19 to 22, 35 to 39, 47 to 51, 63.5 to 64.5) are meant to be quiet: the music
carries them.

## ElevenLabs settings
- Generate each line as its own clip, not the whole script in one go. That is what makes the timing
  controllable.
- One voice for all ten: warm, unhurried, British or Australian. Model Eleven v3 (or Multilingual v2).
  Stability about 50, Similarity about 75, Style 0 to 10, Speaker boost on, Speed 1.0.
- Download each as MP3 (44.1 kHz, 128 kbps or better) and name them `01.mp3` to `10.mp3` in one folder,
  for example `~/Downloads/mimo-vo/`.
- Don't stretch audio in an editor to fit; it sounds wrong. Regenerate at a slightly higher speed instead.

## Assembly
`tools/mimo_vo_mux.sh ~/Downloads/mimo-vo "~/Downloads/Meet MIMO.mp4" [music.mp3]` checks every clip
against its window, warns on any that run long, places each at its start time, mixes in optional music
at a low level, normalises loudness and writes `Meet MIMO (voiced).mp4` next to the video.

Or in ElevenLabs Studio, start a Voiceover project, upload the video, and drop each generated clip on the
timeline at the start time above.
