#!/usr/bin/env bash
# Splits a single ElevenLabs take of the Meet MIMO script at its pauses into 01.mp3..10.mp3, then muxes.
# Usage: tools/mimo_vo_split.sh <take.mp3> <video.mp4> [music.mp3]
set -euo pipefail
TAKE="${1:?take.mp3}"; VID="${2:?video.mp4}"; MUSIC="${3:-}"
OUTDIR="$(dirname "$TAKE")/mimo-vo"; mkdir -p "$OUTDIR"
# find the pauses (>= 0.7s under -35 dB)
mapfile -t EV < <(ffmpeg -v info -i "$TAKE" -af "silencedetect=noise=-35dB:d=0.7" -f null - 2>&1 | grep -o "silence_\(start\|end\): [0-9.]*" | awk '{print $2}')
TOTAL=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TAKE")
# EV alternates start,end,start,end...; segments are between silences
python3 - "$TAKE" "$OUTDIR" "$TOTAL" "${EV[@]}" <<'PY'
import sys, subprocess
take, out, total, *ev = sys.argv[1:]; total=float(total); ev=[float(x) for x in ev]
sil=list(zip(ev[0::2], ev[1::2]))
cuts=[0.0]+[ (s+e)/2 for s,e in sil ]+[total]
segs=[(cuts[i],cuts[i+1]) for i in range(len(cuts)-1)]
if len(segs)!=10: sys.exit(f"found {len(segs)} pieces, expected 10. Pauses detected at: {[(round(s,1),round(e,1)) for s,e in sil]}")
for i,(a,b) in enumerate(segs,1):
    subprocess.run(["ffmpeg","-v","error","-y","-i",take,"-ss",f"{a:.3f}","-to",f"{b:.3f}","-af","silenceremove=start_periods=1:start_threshold=-40dB:stop_periods=1:stop_threshold=-40dB","-c:a","libmp3lame","-q:a","2",f"{out}/{i:02d}.mp3"],check=True)
print("split into", out)
PY
exec "$(dirname "$0")/mimo_vo_mux.sh" "$OUTDIR" "$VID" ${MUSIC:+"$MUSIC"}
