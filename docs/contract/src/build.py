import yaml, sys, re, collections
from schemas import S, ENUMS, obj
from routes import ROUTES

def page(name, item): obj(name, {"items": "[$%s]" % item, "nextCursor": "~str"})
page("BlockedUserPage", "BlockedUser"); page("CalendarPage", "CalendarWeek"); page("ResultThreadPage", "ResultThread")
page("AdminRoleGrantPage", "AdminRoleGrant"); page("AdminOverridePage", "AdminOverride"); page("AdminWeeklyReportPage", "AdminWeeklyReport")
obj("HandleCheck", {"handle": "str", "available": "bool", "?reason": "str"})
obj("CategoryList", {"items": "[$Category]"}); obj("PollList", {"items": "[$Poll]"}); obj("TagInfoList", {"items": "[$TagInfo]"})
obj("ReactionKindList", {"items": "[$ReactionKindInfo]"}); obj("ReactionKindInfo", {"kind": "$ReactionKind", "emoji": "str", "name": "str"})
obj("ExtraVoiceTokenList", {"items": "[$ExtraVoiceToken]"})
obj("ListenRequest", {"completed": "bool", "?positionMs": "int"})
obj("MarkReadRequest", {"?ids": "[uuid]"}); obj("UnreadCount", {"unread": "int"})
obj("AdPlacementResponse", {"ad": "~$AdPlacement"})

BASIC = {"uuid": {"type": "string", "format": "uuid"}, "str": {"type": "string"}, "int": {"type": "integer"}, "bool": {"type": "boolean"},
 "num": {"type": "number"}, "time": {"type": "string", "format": "date-time"}, "date": {"type": "string", "format": "date"},
 "kobo": {"type": "integer", "minimum": 0, "maximum": 2000000000, "description": "Naira in kobo (32-bit integer)."},
 "milli": {"type": "integer", "minimum": -2000000000, "maximum": 2000000000, "description": "Voice Units as integer milli-units, 1 unit = 1000 (32-bit). A balance is 0 to 2,000,000,000."},
 "adjmilli": {"type": "integer", "minimum": -1000000, "maximum": 1000000, "description": "Admin adjustment in milli-units, at most 1,000 units either way per call."}, "json": {}}
def conv(spec, nullable=False):
    if spec.startswith("["):
        s = {"type": "array", "items": conv(spec[1:-1])}
    elif spec.startswith("$"):
        s = {"$ref": "#/components/schemas/" + spec[1:]}
        if nullable: return {"oneOf": [s, {"type": "null"}]}
        return s
    elif spec.startswith("enum:"):
        s = {"type": "string", "enum": spec[5:].split("|")}
    else:
        s = dict(BASIC[spec])
    if nullable and s:
        if "type" in s: s["type"] = [s["type"], "null"]
        if "enum" in s: s["enum"] = s["enum"] + [None]
    return s
for _n in ("Page","TagFollow"): S.pop(_n)
for _n in ("FeedSort","ChargeAction"): ENUMS.pop(_n)
schemas = {}
for n, e in ENUMS.items():
    schemas[n] = {"type": "string", "enum": e.split()}
for n, d in S.items():
    props, req = {}, []
    for k, spec in d["_fields"].items():
        opt = k.startswith("?"); k = k.lstrip("?")
        nul = spec.startswith("~"); spec = spec.lstrip("~")
        props[k] = conv(spec, nul)
        if not opt: req.append(k)
    s = {"type": "object", "properties": props, "additionalProperties": False}
    if req: s["required"] = req
    if d["_desc"]: s["description"] = d["_desc"]
    schemas[n] = s
# fix: Page is documentation only
for n in ("ErrorBody",):
    pass

ERR_DESC = {400: "BAD_REQUEST or MIN_TOPICS", 503: "UNAVAILABLE", 401: "UNAUTHENTICATED or TOKEN_EXPIRED", 402: "INSUFFICIENT_UNITS or FREE_POSTS_EXHAUSTED or EXTRA_VOICE_REQUIRED",
  403: "FORBIDDEN, ROLE_REQUIRED or ACCOUNT_SUSPENDED", 404: "NOT_FOUND", 409: "CONFLICT or a state error such as ALREADY_VOTED, QUESTION_CLOSED, POLL_CLOSED",
  413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 422: "VALIDATION_FAILED", 429: "RATE_LIMITED", 202: "Accepted, not ready yet"}
responses = {}
for c, d in ERR_DESC.items():
    if c == 202: continue
    responses["E%d" % c] = {"description": d, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}}

params = {
 "IdempotencyKey": {"name": "Idempotency-Key", "in": "header", "required": True, "schema": {"type": "string", "minLength": 8, "maxLength": 80},
   "description": "Client-made unique key (a UUID). Same key and same body inside 24 hours returns the first result; same key with another body is 409 IDEMPOTENCY_KEY_REUSED."},
 "GuestId": {"name": "X-Guest-Id", "in": "header", "required": False, "schema": {"type": "string", "format": "uuid"},
   "description": "Client-made id for a guest, so a guest's likes and ad caps work before sign-in."},
}
RL = {"read": "300 per minute per IP or account", "post": "20 posts per 10 minutes per account", "reaction": "60 per minute per account", "vote": "30 per minute per account",
  "like": "120 per minute per account or guest", "payment": "10 per 10 minutes per account", "search": "60 per minute", "voice-upload": "20 per 10 minutes per account",
  "result-post": "30 per 10 minutes per account", "share": "60 per minute"}

TAGDESC = {"me-profile":"My account, profile, settings, blocks, data export and delete","topics-calendar":"Topic of the week, the calendar, categories","questions-feed":"Home, questions, trending and new, answer lists",
"answers":"Text and voice answers, voice upload to Spaces, playback","replies":"Replies: agree, disagree, my experience","likes":"The free heart","reactions":"The 10 reactions, one per person per answer","reports-blocks":"Reports and flags",
"polls-votes":"Polls, one vote per account, live results, explain my vote","what-next":"What Next? proposals, support and challenge, editorial summary","result-posts":"Live results threads and posted numbers (V-7, V-8)","news":"The Newsroom and the three news tags",
"weekly-report":"Published weekly reports and the archive","search":"Search","notifications":"In-app notifications","share":"Share links, cards and the public share page","voice-units":"Voice Units balance, packs, payments, extra voice tokens, receipts",
"support":"Appeals and support","ads":"Labelled advert placements and events","analytics":"Analytics events","system":"Health check, outside /api/v1","admin":"The admin console: roles, today, calendar, override, moderation, news review, results queue, weekly approval, adverts, config, wallets, audit"}
paths = collections.OrderedDict(); counts = collections.OrderedDict(); order=[]
for r in ROUTES:
    p = r["path"]; item = paths.setdefault(p, {})
    op = {"operationId": r["op"], "tags": [r["group"]], "summary": r["summary"]}
    d = r["desc"] or ""
    a = r["auth"]
    if a == "none": op["security"] = []; d += " Auth: none (public)."
    elif a == "optional": op["security"] = [{}, {"wawuId": []}]; d += " Auth: guest or signed in."
    elif a == "token": op["security"] = [{"wawuId": []}]; d += " Auth: WAWU ID token; works before the VOICES profile exists."
    elif a == "user": op["security"] = [{"wawuId": []}]; d += " Auth: signed in with a finished profile."
    elif a == "webhook": op["security"] = []; d += " Auth: provider signature (verif-hash)."
    elif a.startswith("role:"):
        op["security"] = [{"wawuId": []}]; roles = a[5:].split(","); d += " Auth: signed in with role " + " or ".join(roles) + "."
        op["x-wawu-roles"] = roles
    if r["rl"]: d += " Rate limit: " + RL[r["rl"]] + "."
    op["description"] = d.strip()
    ps = []
    for m in re.findall(r"\{(\w+)\}", p):
        ps.append({"name": m, "in": "path", "required": True, "schema": {"type": "string", "format": "uuid"} if m not in ("slug", "code", "key", "handle") else {"type": "string"}})
    for q in r["q"]:
        parts = q.split(":", 2); nm, ty = parts[0], parts[1]; ds = parts[2] if len(parts) > 2 else ""
        sc = {"type": {"str": "string", "int": "integer", "bool": "boolean"}.get(ty, "string")}
        if ty == "uuid": sc = {"type": "string", "format": "uuid"}
        if nm == "limit": sc.update(minimum=1, maximum=50, default=20)
        pp = {"name": nm, "in": "query", "required": nm == "handle" or (nm == "q" and r["path"] != "/admin/topics"), "schema": sc}
        if ds: pp["description"] = ds
        ps.append(pp)
    if r["idem"]: ps.append({"$ref": "#/components/parameters/IdempotencyKey"})
    if a in ("optional",) and r["method"] != "get": ps.append({"$ref": "#/components/parameters/GuestId"})
    elif a == "optional" and r["op"] in ("getHome",): ps.append({"$ref": "#/components/parameters/GuestId"})
    if r["op"] == "getHealth": op["servers"] = [{"url": "https://voices.wawuafrica.com/api"}, {"url": "http://localhost:14000/api"}]
    if ps: op["parameters"] = ps
    if r["req"]:
        op["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/" + r["req"]}}}}
    rs = {}
    st = r["status"]
    if r["res"]:
        rs[str(st)] = {"description": "OK" if st == 200 else ("Created" if st == 201 else "Accepted"), "content": {r["ctype"] or "application/json": {"schema": {"$ref": "#/components/schemas/" + r["res"]}}}}
    elif r["ctype"]:
        rs[str(st)] = {"description": "OK", "content": {r["ctype"]: {"schema": {"type": "string", "format": "binary"} if r["ctype"] != "text/event-stream" else {"type": "string"}}}}
    else:
        rs[str(st)] = {"description": "No content" if st == 204 else "Accepted"}
    errs = set(r["errs"]) | {429}
    if a != "none" and a != "webhook": errs |= {401}
    if a.startswith("role:") : errs |= {403}
    if r["req"]: errs |= {422}
    for e in sorted(errs):
        if e == 202:
            rs["202"] = {"description": "Being made: try again shortly"}
        else: rs[str(e)] = {"$ref": "#/components/responses/E%d" % e}
    op["responses"] = rs
    item[r["method"]] = op
    counts[r["group"]] = counts.get(r["group"], 0) + 1

doc = {"openapi": "3.1.0",
 "info": {"title": "VOICES API", "version": "1.0.0",
  "description": "The VOICES API (launch scope). Rulings V-1 to V-13 apply. Money in kobo, Voice Units in milli-units (1 unit = 1000), times ISO 8601 UTC, ids UUIDv7, cursor pages, one error shape. See docs/contract/CONVENTIONS.md. After-launch items (V-10) are not here: Messages, AI prompts and credits, sponsored surveys, brand pages, push, weekly PDF, ad-free pass.",
  "license": {"name": "Proprietary", "identifier": "LicenseRef-Proprietary"}},
 "servers": [{"url": "https://voices.wawuafrica.com/api/v1", "description": "production"}, {"url": "http://localhost:14000/api/v1", "description": "local"}],
 "security": [{"wawuId": []}],
 "tags": [{"name": g, "description": TAGDESC[g]} for g in counts],
 "paths": paths,
 "components": {"securitySchemes": {"wawuId": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT", "description": "WAWU ID access token (RS256), issuer https://id.wawuafrica.com, verified against https://id.wawuafrica.com/.well-known/jwks.json."}},
   "parameters": params, "responses": responses, "schemas": schemas}}

# GET /me/allowance answers with the Allowances object, or with one AllowanceQuote when ?action= is sent
_ok = doc["paths"]["/me/allowance"]["get"]["responses"]["200"]["content"]["application/json"]
_ok["schema"] = {"oneOf": [{"$ref": "#/components/schemas/Allowances"}, {"$ref": "#/components/schemas/AllowanceQuote"}]}

# A-L1: these two answer 200 with a null body when there is nothing yet
for _p in ("/polls/current", "/weekly-reports/latest"):
    _s = doc["paths"][_p]["get"]["responses"]["200"]["content"]["application/json"]
    _s["schema"] = {"oneOf": [_s["schema"], {"type": "null"}]}

# ref check
import json; doc = json.loads(json.dumps(doc))
txt = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=140)
refs = set(re.findall(r"#/components/schemas/(\w+)", txt)) - set(schemas)
if refs: print("MISSING SCHEMAS", sorted(refs)); sys.exit(1)
used = set(re.findall(r"#/components/schemas/(\w+)", txt))
open(sys.argv[1], "w").write(txt)
print("routes", sum(counts.values()), "paths", len(paths), "schemas", len(schemas))
for g, c in counts.items(): print(g, c)
