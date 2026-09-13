#!/usr/bin/env bash
# Places the ten Meet MIMO voice clips at their measured start times and muxes them onto the video.
# Usage: tools/mimo_vo_mux.sh <clips folder with 01.mp3..10.mp3> <video.mp4> [music.mp3]
set -euo pipefail
DIR="${1:?clips folder}"; VID="${2:?video}"; MUSIC="${3:-}"
# start time (s) and max length (s) per clip, from docs/MEET_MIMO_VO.md
STARTS=(0.8 8.4 15.7 22.4 28.4 38.9 50.9 58.9 64.6 67.9)
MAXES=(7.0 6.4 3.1 4.9 6.6 8.1 6.1 4.4 3.2 4.5)
inputs=(-i "$VID"); filters=""; mix=""; n=0
for i in $(seq -w 1 10); do
  f="$DIR/$i.mp3"; [ -f "$f" ] || { echo "missing $f"; exit 1; }
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  idx=$((10#$i - 1)); max=${MAXES[$idx]}; start=${STARTS[$idx]}
  over=$(python3 -c "print('LONG by %.1fs' % ($dur-$max) if $dur>$max else 'ok')")
  printf "%s  %5.2fs  max %4.1fs  at %5.1fs  %s\n" "$i" "$dur" "$max" "$start" "$over"
  inputs+=(-i "$f"); n=$((n+1))
  ms=$(python3 -c "print(int($start*1000))")
  filters+="[$n:a]adelay=${ms}|${ms}[v$n];"; mix+="[v$n]"
done
if [ -n "$MUSIC" ]; then
  inputs+=(-i "$MUSIC"); n=$((n+1))
  filters+="[$n:a]volume=0.18,afade=t=out:st=71:d=4[m];"; mix+="[m]"
  cnt=11
else cnt=10; fi
filters+="${mix}amix=inputs=$cnt:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]"
OUT="${VID%.mp4} (voiced).mp4"
ffmpeg -v error -y "${inputs[@]}" -filter_complex "$filters" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
echo "wrote: $OUT"
