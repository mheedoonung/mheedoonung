# MongoDB Schema — DramaWave Scraper

**Database:** `dramawave`  
**URI:** `mongodb://admin:password@localhost:27017/dramawave?authSource=admin`  
**Collections:** `series`, `episodes`  
**Stats (2026-06-15):** 3,691 series · 1,574 episodes

---

## Collection: `series`

Populated by Stage 1 (`run-capture-api.sh`). One document per drama/series scraped from the DramaWave homepage feed.

### Indexes

| Name | Fields | Options |
|------|--------|---------|
| `_id_` | `_id` | default |
| `key_1` | `key` | **unique** |
| `series_tags_1` | `series_tags` | — |

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB document ID |
| `key` | String | Series unique key (e.g. `"hhAG9wfmU9"`) — used as foreign key in `episodes` |
| `title` | String | Series title |
| `desc` | String | Synopsis / description |
| `cover` | String (URL) | Cover image URL (WebP, 600px wide) |
| `episode_count` | Number | Total episode count |
| `update_count` | Number | Published episode count |
| `finish_status` | Number | `1` = ongoing, `2` = completed |
| `free` | Boolean | Whether the series is free to watch |
| `vip_type` | Number | VIP tier required (`0` = none) |
| `pay_index` | Number | Episode index from which payment is required |
| `orientation` | Number | `1` = portrait (vertical video) |
| `style` | Number | Display style variant |
| `resource_type` | Number | Content type identifier |
| `link` | String | Deep-link URI (`dramawave://...`) |
| `link_type` | Number | Link type identifier |
| `view_count` | Number | View count |
| `follow_count` | Number | Follow/bookmark count |
| `tags` | String[] | Short badge tags (e.g. `["Hot", "New"]`) |
| `series_tags` | String[] | Full genre/mood/theme tags (indexed) |
| `content_tags` | String[] | Content categorisation tags |
| `content_detail_tags` | String\|null | Detailed content tags |
| `operation_tags` | Object[] | UI badge objects — see sub-schema below |
| `r_info` | Object | Request context metadata (session/request IDs, pagination) |
| `r_info1` | Object | Extended request context — A/B experiments, recall labels, scene info |
| `createdAt` | Date | Document insert timestamp |
| `updatedAt` | Date | Document last-upsert timestamp |

#### `operation_tags[]` sub-schema

| Field | Type | Description |
|-------|------|-------------|
| `text` | String | Badge label (e.g. `"New"`) |
| `text_color` | String | Hex colour for text |
| `bg_start` | String | Hex gradient start colour |
| `bg_end` | String | Hex gradient end colour |
| `tag_type` | String | Tag type identifier |

---

## Collection: `episodes`

Populated by Stage 2 (`fetch-episodes.js`). One document per episode, fetched from `/dm-api/drama/info_v2`.

### Indexes

| Name | Fields | Options |
|------|--------|---------|
| `_id_` | `_id` | default |
| `series_key_1_index_1` | `series_key + index` | **unique** |
| `series_key_1` | `series_key` | — |
| `series_key_1_unlock_1` | `series_key + unlock` | — |

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB document ID |
| `series_key` | String | Foreign key → `series.key` |
| `index` | Number | Episode number (1-based) |
| `id` | String | Episode unique ID (e.g. `"XRLOoFWRL1"`) |
| `name` | String | Episode title / series name |
| `cover` | String (URL) | Episode thumbnail URL |
| `duration` | Number | Duration in seconds |
| `unlock` | Boolean | Whether episode is unlocked for current session |
| `video_type` | String | `"free"` or `"vip"` |
| `episode_price` | Number | Coin price to unlock (if locked) |
| `m3u8_url` | String | Legacy HLS URL (often empty — use `external_audio_*` instead) |
| `video_url` | String | Legacy video URL (often empty) |
| `external_audio_h264_m3u8` | String (URL) | H.264 HLS master playlist URL |
| `external_audio_h265_m3u8` | String (URL) | H.265 HLS master playlist URL |
| `trans_resolution` | String | Available resolutions (e.g. `"1080x1920,720x1280,..."`) |
| `audio` | String\|null | Audio track info |
| `original_audio_language` | String | BCP-47 language code (e.g. `"en-US"`) |
| `h5_available` | Boolean | Whether episode is available on web/H5 |
| `playload` | String (JSON) | Raw payload string — contains `series_id` and `episode_id` |
| `update_time` | Number | Unix timestamp of last update |
| `subtitle_list` | Object[] | Subtitle tracks — see sub-schema below |
| `vtt_list` | Object[]\|null | VTT subtitle list (alternate format, often null) |
| `fetchedAt` | Date | Timestamp when this document was fetched |

#### `subtitle_list[]` sub-schema

| Field | Type | Description |
|-------|------|-------------|
| `language` | String | BCP-47 language code (e.g. `"en-US"`, `"th-TH"`) |
| `type` | String | `"original"` or `"normal"` (translated) |
| `subtitle` | String (URL) | `.srt` subtitle file URL |
| `vtt` | String (URL) | `.vtt` subtitle file URL |
| `display_name` | String | Human-readable language name (e.g. `"English"`, `"Thai"`) |

#### Observed subtitle languages

`en-US`, `th-TH`, `zh-TW`, `ja-JP`, `ko-KR`, `vi-VN`, `id-ID`, `ms-MY`, `tl-PH`, `hi-IN`, `ar-SA`, `ru-RU`, `de-DE`, `fr-FR`, `it-IT`, `es-MX`, `pt-PT`, `pl-PL`, `cs-CZ`, `ro-RO`, `tr-TR`

---

## Relationships

```
series.key  ──(1:N)──  episodes.series_key
```

Each series has zero or more episodes. Episodes without a matching series record are possible during incremental fetches.

---

## Notes

- `series.key` and `episodes.id` are DramaWave's own opaque string identifiers, not MongoDB ObjectIds.
- HLS URLs (`external_audio_h264_m3u8`) expire — re-fetch via `fetch-episodes.js` if download fails.
- `episodes.playload` (sic — upstream typo) stores `{"series_id": <int>, "episode_id": <int>}` as a JSON string.
