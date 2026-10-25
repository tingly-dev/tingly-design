# Platform size presets

Status: researched 2026-10-25; the sourced sizes are in `BOARD_SIZES`, the open items below are not.

## Question

`BOARD_SIZES` (the one list behind the New dialogs, the size panel and `--size`) lacked the sizes people make most: WeChat Channels (视频号) and WeChat Official Account (公众号) covers and images, both orientations. Which sizes do the mainstream platforms publish, and which belong in the table?

## How sure each number is

Most platforms do not publish pixel sizes on a page that a crawler can read (WeChat, Douyin, Kuaishou, Xiaohongshu, Bilibili and Weibo help centres sit behind logins or apps; Zhihu and YouTube help pages refused automated fetches). So the table below says where each number comes from. "Platform-quoted" means a secondary article that says it copies the platform's published figure; "aggregator" means several guides agree but none cites the platform.

| Platform | Use | px | Ratio | Source |
|---|---|---|---|---|
| WeChat Official Account | Headline cover | 900×383 | 2.35:1 | Platform-quoted (Canva CN, Sohu); same number everywhere |
| | Secondary / small cover | 200×200 | 1:1 | Same |
| | Content guide image | 900×500 | 9:5 | Canva CN only |
| WeChat Channels | Cover, landscape | 1080×608 | 16:9 | Digitaling: "视频号官方公布的尺寸比例"; Canva CN; Sohu |
| | Cover, portrait | 1080×1260 | 6:7 | Same |
| Douyin | Video cover, portrait | 1242×1660 | 3:4 | Sohu (the article labels it 9:16, the numbers are 3:4) |
| | Video cover, landscape | 1080×608 | 16:9 | Sohu (same pixels as the Channels landscape cover) |
| | Profile background | 1125×633 | | Sohu |
| Xiaohongshu | Note and video cover | 3:4, 1:1, 4:3 | | Canva CN, Digitaling: "官方推荐的尺寸" (ratios only; pixels are free) |
| Bilibili | Video cover | 1146×717 | 16:10 | Sohu; already in the table |
| Weibo | Profile cover | 980×300 | | Sohu |
| | Headline article cover | 980×560 | | Sohu |
| | Long picture | 800×2000 | | Sohu |
| Instagram | Square / portrait / landscape | 1080×1080 / 1080×1350 / 1080×566 | 1:1, 4:5, 1.91:1 | Buffer, SocialPilot agree; grid previews at 3:4 |
| | Story, Reels | 1080×1920 | 9:16 | Same |
| Facebook | Link / landscape post | 1200×630 | | SocialPilot |
| | Cover | 851×315 | | Same |
| | Event cover | 1920×1005 | | Same |
| LinkedIn | Profile cover | 1584×396 | 4:1 | SocialPilot |
| | Company cover | 1128×191 | | Same |
| | Link / shared image | 1200×627 | | Same |
| X | Header | 1500×500 | 3:1 | Already in the table |
| | Post image | 1600×900 | 16:9 | Already in the table |
| YouTube | Thumbnail | 1280×720 | 16:9 | Already in the table |
| | Channel art | 2560×1440 | | Already in the table |
| Pinterest | Pin | 1000×1500 | 2:3 | Already in the table |
| TikTok | Video, cover | 1080×1920 | 9:16 | Already covered by the Story size |

## Decisions

- **Only sourced numbers become presets.** A preset is a promise that a platform accepts the size, so a figure that only one blog states, or that contradicts itself, stays out.
- **Platforms get their own groups.** The old "Social and covers" group held 20 sizes. People look for a size by platform, so the list is split into WeChat, Chinese platforms and global platforms; sizes several platforms share (square, 4:5, 3:4, 9:16, 16:9, link preview) stay together in "Social".
- **One size, one preset.** The table keeps one preset per pixel size (the size picker maps a size back to its preset). Where two platforms share pixels, the preset's note names both (1080×608 is the Channels and the Douyin landscape cover).
- **Ids stay.** `wechat`, `tall`, `story`, … keep their ids and legacy motion format keys; only their group and wording change.
- **Landscape and portrait.** Each platform that publishes both gets both: Channels (1080×608 and 1080×1260), Douyin (1080×608 and 1242×1660), Instagram (1080×566, 1080×1350, 1080×1080), Xiaohongshu (4:3 `classic`, 3:4 `tall`, 1:1 `square`).

## Left out, and why (open)

- **Body images in a WeChat article.** The editor sets no fixed size (the reading column is about 677 px wide and uploads are shown at full width); guides say 1080 px wide. There is nothing to promise, so the 16:9 and 3:4 sizes already serve.
- **Channels video itself.** 9:16 (1080×1920, `story`) and 16:9 (`wide`); 3:4 (`tall`) is reported by creators but no source states it.
- **Kuaishou, Zhihu.** No size found in any reachable source; Zhihu's article cover is generally described as 16:9 (`wide`).
- **WeChat Moments cover**, **Bilibili portrait cover and column header**, **Douyin live cover (800×800)**. One source or contradictory ones.
- Avatars and logos: not design boards.

Re-check the unreachable official pages (WeChat Official Accounts help, Channels assistant, Douyin creator centre, Xiaohongshu creator centre, YouTube and Meta help) when someone can open them signed in.
