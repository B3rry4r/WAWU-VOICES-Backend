# VOICES prices, costs, allowances and limits

Every value below is a `ConfigEntry` key (table `ConfigEntry`, edited at `PUT /admin/config/{key}`, logged in `ConfigChange`).
Nothing here is written into code. Money is kobo, units are milli-units (1 unit = 1000), see CONVENTIONS.md.
Source column: v4.0 = Developer Brief 360 v4.0 section 6.6 and nearby; Add = Addendum section; V-n = DECISIONS.md.
"Placeholder" = the brief calls the number a placeholder, so it is seeded as `placeholder: true` and the owner confirms it before launch.

## Voice Units base (placeholder)
| Key | Default | Meaning | Source |
|---|---|---|---|
| `units.base_rate_kobo` | 1380 | One unit is worth ₦13.80 (used for display of unit costs in naira only) | v4.0 6.6, placeholder |
| `units.min_purchase_kobo` | 13800 | Smallest purchase, ₦138 | v4.0 2.4, 6.6 |
| `units.expiry_months` | 0 | 0 means units do not expire (brief recommends none in the first year) | v4.0 6.6, placeholder |
| `units.cashable` | false | Never cashed out, never sent to another person | V-9 (fixed, not editable) |

## Unit packs (placeholders, table `UnitTier`, config `units.tiers`)
| slug | Name | `priceKobo` | `unitsMilli` (total) | `bonusMilli` | Units | Bonus | Effective per unit |
|---|---|---|---|---|---|---|---|
| spark | Spark | 13800 | 10000 | 0 | 10 | 0 | ₦13.80 |
| chat | Chat | 34500 | 26000 | 1000 | 26 | 1 | ₦13.27 |
| buzz | Buzz | 69000 | 55000 | 5000 | 55 | 5 | ₦12.55 |
| loud | Loud | 138000 | 115000 | 15000 | 115 | 15 | ₦12.00 |
| mega | Mega | 345000 | 310000 | 60000 | 310 | 60 | ₦11.13 |
| boss | Boss | 690000 | 650000 | 150000 | 650 | 150 | ₦10.62 |

Source: v4.0 6.6. Check on the canvas: PaymentDone shows "Buzz, 55 units (5 bonus), ₦690" and Wallet history shows "Chat pack, ₦345, +26": both match.

## Action costs after the free posts (placeholders)
| Key | Default | Meaning | Source |
|---|---|---|---|
| `allowance.free_posts` | 10 | Lifetime free posts per verified phone number, text and voice together; deleting never returns one | v4.0 2.4, 6.7 |
| `allowance.daily_free_post_enabled` | false | No daily free post after the first 10 | V-8 |
| `cost.text_post_milli` | 500 | Text answer, reply or proposal: 0.5 unit (₦6.90) | v4.0 6.6 |
| `cost.voice_post_milli` | 1000 | Voice post up to 10 s: 1 unit (₦13.80) | v4.0 6.6 |
| `allowance.free_reactions_per_day` | 20 | Free reactions per Lagos day | v4.0 6.3, placeholder |
| `cost.reaction_milli` | 100 | A reaction after the free 20: 0.1 unit; changing or removing is never charged | v4.0 6.3, 6.6 |
| `allowance.free_votes_per_day` | 3 | Free votes per Lagos day | v4.0 6.5, placeholder |
| `cost.vote_milli` | 200 | A vote after the free 3: 0.2 unit; public-interest polls are always free | v4.0 6.5, 6.6 |
| `cost.result_post_milli` | 0 | Posting result numbers is free and uses no free post (fixed) | V-8 |
| `cost.boost_milli` | 5000 | Boost an answer, 5 units. Reserved key: no route and no screen at launch (not drawn) | v4.0 6.6, not built |
| `cost.like_share_read_listen_milli` | 0 | Always free (fixed, not editable) | v4.0 2.3 |

## Extra voice length: one-off tokens (V-8, addendum 5; not placeholders)
| Key | Default | Meaning |
|---|---|---|
| `voice.free_seconds` | 10 | Default voice length |
| `voice.extra30.price_kobo` | 15000 | Extra voice, up to 30 seconds, ₦150, one message, paid in naira |
| `voice.extra30.max_seconds` | 30 | |
| `voice.extra60.price_kobo` | 20000 | Extra voice, up to 1 minute, ₦200, one message, paid in naira |
| `voice.extra60.max_seconds` | 60 | |
| `voice.token_expiry_days` | 0 | 0 = an unused token stays available (addendum open question 1; lead default, owner may override) |

The v4.0 24-hour Voice Pass (Voice 30 at 10.5 units, Voice 60 at 14.5 units, fair-use cap, per-clip switch) is superseded by addendum 5 and V-8: it has no keys and no routes.

## Text and editing limits
| Key | Default | Source |
|---|---|---|
| `text.max_chars` | 500 | v4.0 6.2 (config) |
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
`ratelimit.read_per_min` 300, `ratelimit.post_per_10min` 20, `ratelimit.reaction_per_min` 60, `ratelimit.like_per_min` 120, `ratelimit.vote_per_min` 30, `ratelimit.payment_per_10min` 10, `ratelimit.voice_upload_per_10min` 20, `ratelimit.result_post_per_10min` 30, `ratelimit.search_per_min` 60, `ratelimit.share_per_min` 60, `ratelimit.admin_write_per_min` 120. Source: lead default. An events or election mode multiplies them by `ratelimit.events_mode_factor` (default 0.5).

## Items that are not prices but need the owner (listed in the hand-back)
Base rate and tier prices are placeholders; whether prices include VAT; advert flat fees; token expiry or refund; weekly report publish day and time; second approver for Verified News.
