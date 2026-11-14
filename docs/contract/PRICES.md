# VOICES prices, costs, allowances and limits

Every value below is a `ConfigEntry` key (table `ConfigEntry`, edited at `PUT /admin/config/{key}`, logged in `ConfigChange`).
Nothing here is written into code. Money is kobo, units are milli-units (1 unit = 1000), see CONVENTIONS.md.
Source column: v4.0 = Developer Brief 360 v4.0 section 6.6 and nearby; Add = Addendum section; V-n = DECISIONS.md.
"Placeholder" = the brief calls the number a placeholder, so it is seeded as `placeholder: true` and the owner confirms it before launch.

## Tokens base (V-36, LCH-10; owner figures in docs/launch/PRICING.md)
| Key | Default | Meaning | Source |
|---|---|---|---|
| `units.base_rate_kobo` | 100 | One token is worth ₦1 (used for display of token costs in naira only) | V-36, PRICING.md |
| `units.min_purchase_kobo` | 18300 | Smallest purchase, ₦183 | PRICING.md |
| `units.expiry_months` | 0 | 0 means tokens do not expire | v4.0 6.6 |
| `units.cashable` | false | Never cashed out, never sent to another person | V-9 (fixed, not editable) |

## Token packs (table `UnitTier`, config `units.tiers`; no bonus tokens)
| slug | Name | `priceKobo` | `unitsMilli` | Tokens |
|---|---|---|---|---|
| entry | Entry | 18300 | 183000 | 183 |
| starter | Starter | 36600 | 366000 | 366 |
| standard | Standard | 73200 | 732000 | 732 |
| plus | Plus | 146400 | 1464000 | 1,464 |
| pro | Pro | 366000 | 3660000 | 3,660 |
| premium | Premium | 732000 | 7320000 | 7,320 |
| ultimate | Ultimate | 1464000 | 14640000 | 14,640 |

People get exactly the tokens they pay for (`bonusMilli` is 0 on every pack). The old six packs (Spark to Boss) are switched off, never deleted.

## Action costs (LCH-10, LCH-12)
| Key | Default | Meaning | Source |
|---|---|---|---|
| `allowance.free_posts` | 2 | Lifetime free posts per verified phone number, text and voice together; deleting never returns one. A free post covers a voice of `voice.free_seconds` or a text of `allowance.free_post_text_chars`; a longer one pays in full and keeps the free post | V-38 b, V-46 |
| `allowance.free_post_text_chars` | 500 | Longest text a free post covers | V-38 b |
| `allowance.daily_free_post_enabled` | false | No daily free post after the first free posts | V-8, V-46 |
| `cost.text_post_milli` | 5000 | Text answer or reply after the free posts: this many milli-tokens per `text.price_chars` characters, in proportion, rounded to the hundredth of a token (500 characters = 16.67 tokens) | PRICING.md |
| `text.price_chars` | 150 | Characters one text price covers | PRICING.md |
| `text.max_chars` | 2500 | Longest written post (answer, reply, edit, AI text fix); owner, 14 Nov 2026 (was 5000) | PRICING.md |
| `allowance.messages_per_day` | 20 | Outgoing messages (answers and replies, text and voice, free ones too) per person per Lagos day; a reversed one gives its place back. Reading, listening, likes, shares and reactions never count. The 21st is 429 `DAILY_LIMIT_REACHED` | PRICING.md |
| `allowance.free_reactions_per_day` | 20 | Free reactions per Lagos day | v4.0 6.3, placeholder |
| `cost.reaction_milli` | 100 | A reaction after the free 20: 0.1 token; changing or removing is never charged | v4.0 6.3, 6.6 |
| `allowance.free_votes_per_day` | 3 | Free votes per Lagos day | v4.0 6.5, placeholder |
| `cost.vote_milli` | 200 | A vote after the free 3: 0.2 token; public-interest polls are always free | v4.0 6.5, 6.6 |
| `textfix.cost_milli` | 5000 | The AI text fix: 5 tokens, flat, charged once per request and only when a fix comes back | V-37 |
| `ratelimit.textfix_per_10min` | 10 | AI text fixes asked for per person per 10 minutes | lead default |
| `cost.proposal_milli` | 0 | A What Next? proposal is free at launch, uses no free post, rate limited | V-15 |
| `cost.explain_milli` | 0 | Explain my vote is free at launch, uses no free post, rate limited | V-15 |
| `cost.reaction_remove_milli` | 0 | Removing a reaction is free and never refunds (fixed) | V-15 |
| `cost.result_post_milli` | 0 | Posting result numbers is free and uses no free post (fixed) | V-8 |
| `cost.boost_milli` | 5000 | Boost an answer. Reserved key: no route and no screen at launch (not drawn) | v4.0 6.6, not built |
| `cost.like_share_read_listen_milli` | 0 | Always free (fixed, not editable) | v4.0 2.3 |

## Voice prices (V-36: the old "extra voice" tokens became these prices; PRICING.md)
A voice message is charged when it is sent, by its length. A recording that is cancelled or never sent costs nothing. The key names are the old ones; the value is kobo, and 1 token = 100 kobo.
| Key | Default | Meaning |
|---|---|---|
| `voice.free_seconds` | 60 | Length a free post covers (V-46; it was 10) |
| `voice.extra30.price_kobo` | 7800 | A voice message up to `voice.extra30.max_seconds`: 78 tokens |
| `voice.extra30.max_seconds` | 30 | |
| `voice.extra60.price_kobo` | 10000 | A voice message over 30 seconds and up to `voice.extra60.max_seconds`: 100 tokens |
| `voice.extra60.max_seconds` | 60 | The longest voice message |
| `cost.voice_post_milli` | 78000 | Display copy of the up-to-30-second price (milli-tokens); the charge reads `voice.extra30.price_kobo` |
| `voice.token_expiry_days` | 0 | Extra voice tokens bought before the new prices stay usable (one message each, no charge) |

`POST /payments` with `kind: EXTRA_VOICE` is no longer accepted (422): extra voice is not sold on its own.

## Public config and countries
| Key | Default | Meaning |
|---|---|---|
| `config.public` | derived | `GET /config/public` is built from the keys above; it has no values of its own |
| `countries.list` | NG live; GH, KE, ZA coming | Launch list for `GET /countries` (lead default) |
| `search.similar_proposals_max` | 3 | Similar proposals shown before posting |

## Text and editing limits
| Key | Default | Source |
|---|---|---|
| `text.max_chars` | 2500 | owner, 14 Nov 2026 (was 5000; before that 500) |
| `proposal.max_chars` | 500 | Longest What Next? proposal or vote explanation (free actions keep the old limit) |
| `text.edit_window_seconds` | 300 | v4.0 6.2 |
| `reply.depth` | 1 | v4.0 6.2 (fixed) |
| `profile.voice_card_seconds` | 10 | canvas ProfileSetup |
| `clip.target_bitrate_kbps` | 32 | audio plan (about 30 KB per 10 s) |

## Payments
| Key | Default | Meaning | Source |
|---|---|---|---|
| `payment.provider` | flutterwave | Live keys, server-side verify on return and by reconcile | V-11 |
| `payment.expiry_minutes` | 30 | An unpaid INITIATED payment expires | lead default |
| `payment.reconcile_interval_minutes` | 10 | Pending payments re-verified | lead default |
| `payment.currency` | NGN | | v4.0 |
| `tax.vat_percent_x100` | 750 | 7.5 percent, shown to finance only; prices are assumed VAT-inclusive | v4.0 6.6 illustration, open decision 1 |
| `tax.payment_fee_percent_x100` | 150 | About 1.5 percent payment fee, finance only | v4.0 6.6 illustration |

## Polls and live results
| Key | Default | Source |
|---|---|---|
| `poll.results_cache_seconds` | 3 | v4.0 6.5 (cache hot polls) |
| `poll.show_live_results` | true | addendum 7.5 |
| `override.duration_hours` | 24 | addendum 4 |

## Adverts (flat fee at launch)
| Key | Default | Source |
|---|---|---|
| `ads.native_every_min` | 8 | v4.0 6.9 (8 to 10, config) |
| `ads.native_every_max` | 10 | v4.0 6.9 |
| `ads.never_in_first` | 3 | v4.0 6.9 |
| `ads.frequency_cap_per_day` | 3 | canvas AdminAds (3 a day per person) |
| `ads.price.flat_per_day_kobo` | null | Not given by any brief: the admin sets it. Placeholder, owner to give |
| `ads.price.flat_per_week_kobo` | null | Not given: canvas says "from the admin price list". Placeholder, owner to give |
| `ads.blocked_categories` | betting, tobacco, health claims, political | v4.0 6.9 (political: none at launch) |
| `ads.never_beside` | politics, religion, health, sexual life | v4.0 6.9, canvas |

Pricing models cost per thousand views and cost per click are after launch. The ad-free pass (v4.0 7 days, price "config") is V-10: no key.

## News tags and moderation
| Key | Default | Source |
|---|---|---|
| `news.flag_threshold` | 4 | canvas AdminNews ("flagged as misleading 4 times"); lead default |
| `news.verified_needs_second_approver` | false | Addendum open question 2; lead default, owner may override |
| `moderation.sensitive_topics` | politics, religion, sex, tribe | v4.0 6.10 |
| `moderation.takedown_target_hours` | 24 | v4.0 6.10 |

## Weekly report
| Key | Default | Source |
|---|---|---|
| `weekly.draft_after_poll_close_minutes` | 10 | canvas AdminWeekly (drafted 12:10am after the poll closed at 11:59pm) |
| `weekly.default_publish_weekday` | 1 | Monday (canvas Today and AdminWeekly say 6pm after drafting). The archive board says "Sunday 3 Jan, 6pm". The two disagree: addendum open question 3 is the owner's; lead default Monday 18:00 Lagos |
| `weekly.default_publish_hour` | 18 | |
| `weekly.min_group_size` | 20 | Groups smaller than this are left out of the report (anonymity; lead default) |

## Rate limits (see CONVENTIONS.md)
`ratelimit.read_per_min` 300, `ratelimit.post_per_10min` 20, `ratelimit.reaction_per_min` 60, `ratelimit.like_per_min` 120, `ratelimit.vote_per_min` 30, `ratelimit.payment_per_10min` 10, `ratelimit.voice_upload_per_10min` 20, `ratelimit.result_post_per_10min` 30, `ratelimit.search_per_min` 60, `ratelimit.share_per_min` 60, `ratelimit.admin_write_per_min` 120. Source: lead default. An events or election mode multiplies them by `ratelimit.events_mode_factor` (default 0.5) only while `ratelimit.events_mode` is on (default off). Listen reports have their own limits: `ratelimit.listen_per_min` 120 per visitor or account and `ratelimit.listen_ip_per_min` 300 per network address; the global per-address limit (`THROTTLE_LIMIT`, 600) does not apply to them.

## Items that are not prices but need the owner (listed in the hand-back)
Whether prices include VAT; advert flat fees; token expiry or refund; weekly report publish day and time; second approver for Verified News.
