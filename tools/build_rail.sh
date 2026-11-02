#!/bin/sh
# Builds data/rail.json from Natural Earth 1:10m railroads (public domain):
# https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_railroads.geojson
# Usage: tools/build_rail.sh path/to/ne_10m_railroads.geojson
set -e
npx mapshaper "$1" \
  -drop fields=* \
  -simplify 3% keep-shapes \
  -dissolve \
  -o "$(dirname "$0")/../data/rail.json" format=topojson quantization=50000 force
