d=2026-02-24
while [ "$d" != 2025-02-24 ]; do
  echo $d
  d=$(date -j -v -1d -f "%Y-%m-%d" $d +%Y-%m-%d)
  git checkout `git rev-list --max-count=1 main --before="$d"`
  ./mach python mozbuild_vs_js_modules_actors_stats.py
done