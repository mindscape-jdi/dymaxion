# Dymaxion Clock

A live world clock drawn on R. Buckminster Fuller's **Dymaxion (Airocean) map**, showing where it is day, twilight and night right now.

![Fuller's unfolded icosahedron with the day/night terminator](icon.svg)

## Features

- **Accurate sun position.** The point where the sun is directly overhead is computed every frame from the Astronomical Almanac's solar formulas (declination, equation of time, sidereal time), accurate to about 0.01°.
- **Day, twilight and night bands.** Shading follows real sun altitudes: sunrise/sunset at −0.833° (includes refraction and the sun's radius), then civil (−6°), nautical (−12°) and astronomical (−18°) twilight.
- **True Dymaxion layout.** Fuller's icosahedral net using the Gray–Fuller formulas from [d3-geo-polygon](https://github.com/d3/d3-geo-polygon) (`geoAirocean`). Shading is clipped correctly across the cut edges between faces.
- **Solar noon line.** The sun's path for ±12 hours, marked with the UTC hour at which it's noon at each spot.
- **World clock.** 20 cities with local civil time (correct time zones and DST) and their current day/night state.
- **Inspect anywhere.** Hover or tap the map for latitude/longitude, local solar time and sun altitude.
- **Time travel.** Fast-forward at 10 min/s up to 30 days/s to watch days and seasons pass, or jump to any date.
- **Your location** (optional) via the browser's geolocation.
- **Installable and offline.** A web app manifest and service worker; all libraries and map data are bundled.

## Run it

It's a static site with no build step. Serve the folder over HTTP (modules and the service worker won't load from `file://`):

```sh
npm start          # python3 -m http.server 8000
# open http://localhost:8000
```

It also works as-is on GitHub Pages or any static host.

## Test

```sh
npm test
```

Checks the solar maths against almanac values for solstices, equinoxes and the equation of time.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Page and styling |
| `app.js` | Map rendering, time controls, world clock |
| `sun.js` | Solar position and altitude maths |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline support and install |
| `vendor/` | d3-array 3.2.4, d3-geo 3.1.1, d3-geo-projection 4.0.0, d3-geo-polygon 2.0.1, topojson-client 3.1.0 (ISC licensed) |
| `data/land-50m.json` | Natural Earth 1:50m land, from world-atlas 2.0.2 (public domain) |
