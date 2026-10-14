# YouTube Ad-First Search Regression

## Changes

- Recognize an observed query and populated YouTube results container as SEARCH_RESULTS even when only ads/channel cards are visible.
- Keep ENTER verification separate from ordinary-video discovery.
- Discover the first ordinary video for WAIT_FOR video_list through bounded exploration, rather than accepting an ad thumbnail.
- Exclude thumbnails within observed advertisement groups, including Vietnamese sponsorship labels.
- Keep ordinal scrolling on the unique observed YouTube results container.
- Prefer a freshly validated native container ID for scrolling when its bounds are fully visible; retain clipped-area scrolling otherwise.
- Do not infer end-of-list solely from false canScrollMore when content has changed.

## Earlier Verification

- 96 unit tests passed. TypeScript and lint on changed files passed.
- Real Samsung device: the original OpenAI ad-first screen contained 72 UI nodes. Before the fix it was classified YOUTUBE_BROWSE; after the fix it was classified SEARCH_RESULTS with the observed OpenAI query.
- Real ordinary-video discovery: NOT PASSED. Earlier attempts stopped with NOT_FOUND/container ambiguity; the final attempt performed seven bounded gestures and timed out within the 30-second budget without verifying an ordinary video.
- No advertisement or video was clicked. Every test Session was closed.
- Successful video playback has NOT been verified. Unit fixtures do not establish hardware success.

## Remaining Work

Capture consecutive public search-result hierarchies and gesture displacement to determine why this ad layout does not expose stable ordinary-video candidates during bounded scrolling. Preserve ambiguity guards, exact query checks and post-action verification; do not report success based only on sending a gesture.

## Extended Discovery Budget

Following the user's request, Appium WAIT_FOR video_list now uses the configurable exploration budget (120 seconds by default) rather than an AI-generated 20-second wait. The default scroll limit is 24. Before any ordinary video has been observed, downward gestures use 50% of the observed region; after video evidence appears, scrolling returns to 35% to preserve overlap. If an empty viewport does not change but canScrollMore is true, poll for changed data within the remaining deadline instead of immediately issuing another gesture. Cancellation, ambiguity, device errors and verified end-of-list still stop the operation.

98 unit tests, TypeScript and scoped lint passed. The first real-device attempt with these limits was blocked because the device no longer displayed the expected OpenAI results (16 observed nodes, no query); its Session was closed. These new limits have NOT yet been proven to find/play a video on hardware.

## Latest Real-Device Retest: Discovery PASS

After the user prepared YouTube search results again, the test observed SEARCH_RESULTS, the actual query `openai`, and 85 UI nodes. The test guard was corrected to accept this capitalization; production query verification was not changed.

- WAIT_FOR video_list: VERIFIED in 21,993 ms.
- Five gestures total: one upward gesture to verify list origin, then four downward gestures using scrollPercent=0.5 while no ordinary video was observed.
- Six snapshots; one ordinary-video identity discovered; no duplicates.
- Exploration ended FOUND before the 120-second budget, rather than timing out at 20 seconds.
- No ad/video click; Session cleanup completed successfully.
- Discovery is proven for this run. Playback and larger video ordinals have not been tested in this retest; performance may differ on other ad layouts or connections.

Scoped lint of the updated integration script passed. The earlier NOT_FOUND, TIMEOUT and blocked attempts above remain historical evidence, not the outcome of this latest test.

## 60% Scroll Retest: Discovery PASS

The user requested 50-60% per gesture and prepared the initial `openai` search screen. The empty-video scroll default and configurable maximum were increased to 0.6; ordinary-video overlap scrolling remains 0.35 by default. 0.5 is still a valid override. Budget and cancellation limits are unchanged.

- Initial state: SEARCH_RESULTS, query `openai`, 98 observed nodes.
- WAIT_FOR video_list: VERIFIED in 24,376 ms; exploration FOUND in 24,375 ms.
- Five gestures total: one origin check at 35%, four downward gestures at 60%.
- Six snapshots; one ordinary-video identity discovered; no duplicates.
- No advertisement or video click; Session closed successfully.
- 98 unit tests, TypeScript and scoped lint passed.
- This run did not establish a speed improvement over the earlier 50% run (21,993 ms). Different initial layouts and response latency prevent drawing a controlled performance conclusion.
- Discovery passed; playback remains untested in these scroll-only checks.

## 80% / Fourth-Video Retest

The user explicitly requested 80% scrolling before the first video, 35% after it appeared, and a click on video 4. The empty-video default and maximum are now 0.8; overlap scrolling remains 0.35. The integration script requires the explicit `--click-fourth` flag to attempt that click. It never clicks advertisements or account controls.

- Initial state: SEARCH_RESULTS, query `openai`, 98 nodes.
- First-video discovery: VERIFIED in 21,258 ms. Four gestures total: one origin check at 35%, then three downward gestures at 80%. Five snapshots; one video identity discovered.
- Fourth-video attempt: BLOCKED with AMBIGUOUS after 49,671 ms, 13 gestures and 14 snapshots. Three video identities were remembered with 13 duplicate observations. Every downward gesture in this stage used 35%.
- Reason: `No overlap with remembered results; ordinal continuity was lost.` The next visible results could not safely be assigned ordinal 4.
- No video or ad click was dispatched. The Session was closed. Playback of video 4 was NOT verified.
- 98 unit tests, TypeScript and scoped lint passed. These results do not override the hardware ambiguity.

The next integration improvement must preserve/recover observed result continuity around ad/carousel gaps rather than simply increasing gesture size or bypassing the ambiguity check. Increasing to 80% improved the gesture count in this run but does not establish a controlled latency improvement or guarantee exact ordinal discovery on every layout.

## Current Configuration: 90% Then 60%

Following the user's clarification, empty-video scrolling now defaults to 90%. After the first ordinary-video identity is recorded, ordinal video exploration uses a separate 60% setting (`ANDROID_EXPLORATION_VIDEO_SCROLL_PERCENT`). Other targets and origin checks retain the 35% base setting. Cancellation, deadlines, ordinal-memory checks and ambiguity guards are unchanged.

98 unit tests passed, including the observed switch from 90% to 60%; TypeScript passed. This configuration has not been retested on hardware. Earlier PASS/BLOCKED results describe earlier configurations, not a guarantee of fourth-video selection at these new percentages.

## 90% / 60% Hardware Retest

The user requested testing the current configuration. One Session was used on the same Samsung device with the observed `openai` search results (98 nodes).

- First-video discovery: VERIFIED in 21,783 ms; four gestures total (one 35% origin check and three 90% downward gestures), five snapshots, two video identities observed.
- Fourth-video attempt: BLOCKED with AMBIGUOUS in 21,383 ms; five gestures total (one 35% origin check and four 60% downward gestures), six snapshots, two remembered identities and four duplicate observations.
- Error: `No overlap with remembered results; ordinal continuity was lost.`
- No click was dispatched to video 4 or an advertisement. The Session was closed successfully.
- This configuration discovers video content but has NOT passed exact fourth-video selection/playback. Increasing the video-phase scroll percentage did not solve the continuity problem in this run.

The native-container gesture argument is documented in the [official UiAutomator2 gesture reference](https://github.com/appium/appium-uiautomator2-driver/blob/master/docs/android-mobile-gestures.md#mobile-scrollgesture).

## Repeat The Read-Only/Scroll Test

Run `node.exe tests/youtube-ad-search.integration.cjs DEVICE_SERIAL` while YouTube is displaying the OpenAI search results. It reads UI and scrolls only; it never clicks an ad or video. Add `--inspect` to read hierarchy labels without scrolling.
