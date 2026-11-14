# Application demo samples (v1.0.0)

Checked: 2026-11-15 (Asia/Tokyo). These assets are shipped with the app; no runtime request to the source websites is needed.

## Original fictional materials

`desk-before.png`, `desk-moved.png`, `desk-missing.png`, `red.png`, `round.png`, `panel.png`, `blue.mp4`: original Canvas drawings made for this project. No third-party images, brands or real equipment data are included. The fictional panel reads PUMP A-12 / -12.50 kPa. These original sample materials are dedicated to CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

The desk images are illustrations of a fixed tabletop, not photos of actual equipment. The moving-blue video is an authored animation, decoded and analyzed as video frames by the real color/motion processors. Sample answers or detection masks are not shipped.

## Workshop video

`workshop.mp4`: original 8-second, 640x420, 12fps, silent H.264 MP4 composition. The box/background and movement are original drawings/animation; the cup is a crop/resize of Rachel Michetti's CC0 coffee photograph already included in this project. The video is clearly presented as a composition, not real camera footage.

Coffee source: scikit-image v0.25.2, https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/coffee.png

Original coffee SHA-256: cc02f8ca188b167c775a7101b5d767d1e71792cf762c33d6fa15a4599b5a8de7

Existing permission/source record: ../samples/coffee-LICENSE.txt

## Road photograph

`road.jpg`: Brett Sayles, “Concrete Road”, Pexels photo 1581016.

- Photo/source: https://www.pexels.com/photo/concrete-road-1581016/
- Downloaded rendition: https://images.pexels.com/photos/1581016/pexels-photo-1581016.jpeg?auto=compress&cs=tinysrgb&w=960
- License: Pexels License, https://www.pexels.com/license/
- 960x640, 71,524 bytes; SHA-256: 5378d491ac96009045f5ab5e538c63607f63726b4fd2365ff9090bddfb296311
- The official license permits free use, modification and use in apps. Attribution is optional; credit is included here. Restrictions include implying endorsement, selling unchanged copies, and redistribution on stock-photo/wallpaper platforms. This app includes the photograph as an image-processing example, not a stock-photo service. No photographer endorsement is claimed.

The existing ADE20K model is actually run on this photograph. The model output is not embedded in this sample directory. Night/lava images in developer verification are modified experimental composites.

## Generation and integrity

`scripts/create-demo-samples.mjs` generates original sample stills/videos in an explicit developer action using installed Chrome and ffmpeg. It reuses the existing coffee photo and the checked road rendition; it does not run at app startup. ffmpeg is a development tool and is not distributed or a runtime dependency. `manifest.json` pins the bytes/SHA-256 of each shipped sample; `npm run build` verifies their copies in dist.

No new AI model, dictionary, runtime or paid service is included. Model/runtime licenses remain in the existing project notices and public/licenses/.
