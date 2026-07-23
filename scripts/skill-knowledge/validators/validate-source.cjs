/**
 * Generated standalone Draft 2020-12 validator (bundled).
 * Source: design_docs/skill-knowledge-graph/schemas/knowledge-source.schema.json
 * Source-schema-sha256: 6920e0532d209ff63d96e0ca824f06c5a5e8a343714a824c3b62d5810a557f3d
 * Schema-fingerprint: 4f1c52569e8c64ae7e001736528b23d14d846655720c4dd6b225cab874feddf2
 * Regenerate: node scripts/skill-knowledge/generate-validators.mjs
 */
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports2.default = equal;
  }
});

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports2.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS({
  "node_modules/ajv-formats/dist/formats.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.formatNames = exports2.fastFormats = exports2.fullFormats = void 0;
    function fmtDef(validate, compare) {
      return { validate, compare };
    }
    exports2.fullFormats = {
      // date: http://tools.ietf.org/html/rfc3339#section-5.6
      date: fmtDef(date, compareDate),
      // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
      time: fmtDef(getTime(true), compareTime),
      "date-time": fmtDef(getDateTime(true), compareDateTime),
      "iso-time": fmtDef(getTime(), compareIsoTime),
      "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
      // duration: https://tools.ietf.org/html/rfc3339#appendix-A
      duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
      uri,
      "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
      // uri-template: https://tools.ietf.org/html/rfc6570
      "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
      // For the source: https://gist.github.com/dperini/729294
      // For test cases: https://mathiasbynens.be/demo/url-regex
      url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
      email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
      hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
      // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
      ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
      ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
      regex,
      // uuid: http://tools.ietf.org/html/rfc4122
      uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
      // JSON-pointer: https://tools.ietf.org/html/rfc6901
      // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
      "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
      "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
      // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
      "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
      // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
      // byte: https://github.com/miguelmota/is-base64
      byte,
      // signed 32 bit integer
      int32: { type: "number", validate: validateInt32 },
      // signed 64 bit integer
      int64: { type: "number", validate: validateInt64 },
      // C-type float
      float: { type: "number", validate: validateNumber },
      // C-type double
      double: { type: "number", validate: validateNumber },
      // hint to the UI to hide input strings
      password: true,
      // unchecked string payload
      binary: true
    };
    exports2.fastFormats = {
      ...exports2.fullFormats,
      date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
      time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
      "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
      "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
      "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
      // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
      uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
      "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
      // email (sources from jsen validator):
      // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
      // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
      email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
    };
    exports2.formatNames = Object.keys(exports2.fullFormats);
    function isLeapYear(year) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }
    var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
    var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    function date(str) {
      const matches = DATE.exec(str);
      if (!matches)
        return false;
      const year = +matches[1];
      const month = +matches[2];
      const day = +matches[3];
      return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
    }
    function compareDate(d1, d2) {
      if (!(d1 && d2))
        return void 0;
      if (d1 > d2)
        return 1;
      if (d1 < d2)
        return -1;
      return 0;
    }
    var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
    function getTime(strictTimeZone) {
      return function time(str) {
        const matches = TIME.exec(str);
        if (!matches)
          return false;
        const hr = +matches[1];
        const min = +matches[2];
        const sec = +matches[3];
        const tz = matches[4];
        const tzSign = matches[5] === "-" ? -1 : 1;
        const tzH = +(matches[6] || 0);
        const tzM = +(matches[7] || 0);
        if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
          return false;
        if (hr <= 23 && min <= 59 && sec < 60)
          return true;
        const utcMin = min - tzM * tzSign;
        const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
        return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
      };
    }
    function compareTime(s1, s2) {
      if (!(s1 && s2))
        return void 0;
      const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
      const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
      if (!(t1 && t2))
        return void 0;
      return t1 - t2;
    }
    function compareIsoTime(t1, t2) {
      if (!(t1 && t2))
        return void 0;
      const a1 = TIME.exec(t1);
      const a2 = TIME.exec(t2);
      if (!(a1 && a2))
        return void 0;
      t1 = a1[1] + a1[2] + a1[3];
      t2 = a2[1] + a2[2] + a2[3];
      if (t1 > t2)
        return 1;
      if (t1 < t2)
        return -1;
      return 0;
    }
    var DATE_TIME_SEPARATOR = /t|\s/i;
    function getDateTime(strictTimeZone) {
      const time = getTime(strictTimeZone);
      return function date_time(str) {
        const dateTime = str.split(DATE_TIME_SEPARATOR);
        return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
      };
    }
    function compareDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const d1 = new Date(dt1).valueOf();
      const d2 = new Date(dt2).valueOf();
      if (!(d1 && d2))
        return void 0;
      return d1 - d2;
    }
    function compareIsoDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
      const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
      const res = compareDate(d1, d2);
      if (res === void 0)
        return void 0;
      return res || compareTime(t1, t2);
    }
    var NOT_URI_FRAGMENT = /\/|:/;
    var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
    function uri(str) {
      return NOT_URI_FRAGMENT.test(str) && URI.test(str);
    }
    var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
    function byte(str) {
      BYTE.lastIndex = 0;
      return BYTE.test(str);
    }
    var MIN_INT32 = -(2 ** 31);
    var MAX_INT32 = 2 ** 31 - 1;
    function validateInt32(value) {
      return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
    }
    function validateInt64(value) {
      return Number.isInteger(value);
    }
    function validateNumber() {
      return true;
    }
    var Z_ANCHOR = /[^\\]\\Z/;
    function regex(str) {
      if (Z_ANCHOR.test(str))
        return false;
      try {
        new RegExp(str);
        return true;
      } catch (e) {
        return false;
      }
    }
  }
});

// raw/validate-source.cjs
module.exports = validate20;
module.exports.default = validate20;
var schema32 = { "type": "object", "additionalProperties": false, "required": ["schema_version", "kind", "id", "runtime_hosts", "skills", "entries", "hop_policy", "critical_pin_budget", "router_budget", "rollout"], "properties": { "schema_version": { "$ref": "#/$defs/schemaVersion" }, "kind": { "const": "portfolio" }, "id": { "type": "string", "pattern": "^portfolio:[a-z0-9][a-z0-9.-]*$" }, "runtime_hosts": { "type": "array", "minItems": 4, "maxItems": 4, "items": { "$ref": "#/$defs/knownHost" }, "uniqueItems": true, "allOf": [{ "contains": { "const": "claude-code" } }, { "contains": { "const": "codex" } }, { "contains": { "const": "cursor" } }, { "contains": { "const": "kimi-code" } }] }, "skills": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/portfolioSkillRef" } }, "entries": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/entry" } }, "hop_policy": { "$ref": "#/$defs/hopPolicy" }, "critical_pin_budget": { "$ref": "#/$defs/pinBudget" }, "router_budget": { "$ref": "#/$defs/routerBudget" }, "rollout": { "enum": ["K0", "K1", "K2", "K3"] } } };
var schema34 = { "enum": ["claude-code", "codex", "cursor", "kimi-code"] };
var func1 = Object.prototype.hasOwnProperty;
var func0 = require_equal().default;
var pattern4 = new RegExp("^portfolio:[a-z0-9][a-z0-9.-]*$", "u");
var pattern5 = new RegExp("^skill:[a-z0-9][a-z0-9.-]*$", "u");
var pattern6 = new RegExp("^[A-Za-z0-9._/-]+\\.json$", "u");
function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate22.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.manifest === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "manifest" }, message: "must have required property 'manifest'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "manifest")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern5.test(data0)) {
          const err3 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/skillId/pattern", keyword: "pattern", params: { pattern: "^skill:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^skill:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/skillId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.manifest !== void 0) {
      let data1 = data.manifest;
      if (typeof data1 === "string") {
        if (!pattern6.test(data1)) {
          const err5 = { instancePath: instancePath + "/manifest", schemaPath: "#/$defs/repoJsonPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._/-]+\\.json$" }, message: 'must match pattern "^[A-Za-z0-9._/-]+\\.json$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/manifest", schemaPath: "#/$defs/repoJsonPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate22.errors = vErrors;
  return errors === 0;
}
validate22.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var pattern7 = new RegExp("^entry:[a-z0-9][a-z0-9.-]*$", "u");
var func3 = require_ucs2length().default;
function validate25(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate25.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (Array.isArray(data)) {
    const len0 = data.length;
    for (let i0 = 0; i0 < len0; i0++) {
      let data0 = data[i0];
      if (typeof data0 === "string") {
        if (func3(data0) < 1) {
          const err0 = { instancePath: instancePath + "/" + i0, schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
      } else {
        const err1 = { instancePath: instancePath + "/" + i0, schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    let i1 = data.length;
    let j0;
    if (i1 > 1) {
      outer0: for (; i1--; ) {
        for (j0 = i1; j0--; ) {
          if (func0(data[i1], data[j0])) {
            const err2 = { instancePath, schemaPath: "#/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
            break outer0;
          }
        }
      }
    }
  } else {
    const err3 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "array" }, message: "must be array" };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  validate25.errors = vErrors;
  return errors === 0;
}
validate25.evaluated = { "items": true, "dynamicProps": false, "dynamicItems": false };
var schema43 = { "type": "object", "additionalProperties": false, "required": ["host", "source_file", "binding", "surface_kind", "targets", "lifecycle"], "properties": { "host": { "$ref": "#/$defs/knownHost" }, "source_file": { "$ref": "#/$defs/repoMarkdownPath" }, "binding": { "$ref": "#/$defs/entrySurfaceBinding" }, "surface_kind": { "enum": ["command", "skill_entry", "agents_navigation"] }, "targets": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/target" } }, "lifecycle": { "$ref": "#/$defs/lifecycle" } } };
var schema46 = { "type": "object", "additionalProperties": false, "required": ["kind", "value"], "properties": { "kind": { "enum": ["marker", "anchor"] }, "value": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$" } } };
var pattern8 = new RegExp("^[A-Za-z0-9._/-]+\\.md$", "u");
var pattern9 = new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]*$", "u");
var pattern11 = new RegExp("^module:[a-z0-9][a-z0-9.-]*$", "u");
var pattern12 = new RegExp("^point:[a-z0-9][a-z0-9.-]*$", "u");
function validate28(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate28.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length < 1) {
      const err0 = { instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "skill" || key0 === "module" || key0 === "point")) {
        const err1 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.skill !== void 0) {
      let data0 = data.skill;
      if (typeof data0 === "string") {
        if (!pattern5.test(data0)) {
          const err2 = { instancePath: instancePath + "/skill", schemaPath: "#/$defs/skillId/pattern", keyword: "pattern", params: { pattern: "^skill:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^skill:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      } else {
        const err3 = { instancePath: instancePath + "/skill", schemaPath: "#/$defs/skillId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.module !== void 0) {
      let data1 = data.module;
      if (typeof data1 === "string") {
        if (!pattern11.test(data1)) {
          const err4 = { instancePath: instancePath + "/module", schemaPath: "#/$defs/moduleId/pattern", keyword: "pattern", params: { pattern: "^module:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^module:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/module", schemaPath: "#/$defs/moduleId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.point !== void 0) {
      let data2 = data.point;
      if (typeof data2 === "string") {
        if (!pattern12.test(data2)) {
          const err6 = { instancePath: instancePath + "/point", schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/point", schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
  } else {
    const err8 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err8];
    } else {
      vErrors.push(err8);
    }
    errors++;
  }
  validate28.errors = vErrors;
  return errors === 0;
}
validate28.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema51 = { "type": "object", "additionalProperties": false, "required": ["state", "since"], "properties": { "state": { "enum": ["draft", "accepted", "deprecated", "retired"] }, "since": { "$ref": "#/$defs/date" }, "replacement": { "$ref": "#/$defs/globalId" }, "rationale": { "$ref": "#/$defs/nonEmptyString" } }, "allOf": [{ "if": { "properties": { "state": { "enum": ["deprecated", "retired"] } }, "required": ["state"] }, "then": { "required": ["rationale"] } }] };
var formats0 = require_formats().fullFormats.date;
var pattern13 = new RegExp("^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$", "u");
function validate30(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate30.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing0;
    if (data.state === void 0 && (missing0 = "state")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.state !== void 0) {
        let data0 = data.state;
        if (!(data0 === "deprecated" || data0 === "retired")) {
          const err1 = {};
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.rationale === void 0) {
        const err2 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err3 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.state === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.since === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "since" }, message: "must have required property 'since'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "state" || key0 === "since" || key0 === "replacement" || key0 === "rationale")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.state !== void 0) {
      let data1 = data.state;
      if (!(data1 === "draft" || data1 === "accepted" || data1 === "deprecated" || data1 === "retired")) {
        const err7 = { instancePath: instancePath + "/state", schemaPath: "#/properties/state/enum", keyword: "enum", params: { allowedValues: schema51.properties.state.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.since !== void 0) {
      let data2 = data.since;
      if (typeof data2 === "string") {
        if (!formats0.validate(data2)) {
          const err8 = { instancePath: instancePath + "/since", schemaPath: "#/$defs/date/format", keyword: "format", params: { format: "date" }, message: 'must match format "date"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/since", schemaPath: "#/$defs/date/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.replacement !== void 0) {
      let data3 = data.replacement;
      if (typeof data3 === "string") {
        if (!pattern13.test(data3)) {
          const err10 = { instancePath: instancePath + "/replacement", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/replacement", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data4 = data.rationale;
      if (typeof data4 === "string") {
        if (func3(data4) < 1) {
          const err12 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  validate30.errors = vErrors;
  return errors === 0;
}
validate30.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate27(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate27.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.host === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.source_file === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source_file" }, message: "must have required property 'source_file'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.surface_kind === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "surface_kind" }, message: "must have required property 'surface_kind'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.targets === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "targets" }, message: "must have required property 'targets'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.lifecycle === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "lifecycle" }, message: "must have required property 'lifecycle'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "host" || key0 === "source_file" || key0 === "binding" || key0 === "surface_kind" || key0 === "targets" || key0 === "lifecycle")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.host !== void 0) {
      let data0 = data.host;
      if (!(data0 === "claude-code" || data0 === "codex" || data0 === "cursor" || data0 === "kimi-code")) {
        const err7 = { instancePath: instancePath + "/host", schemaPath: "#/$defs/knownHost/enum", keyword: "enum", params: { allowedValues: schema34.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.source_file !== void 0) {
      let data1 = data.source_file;
      if (typeof data1 === "string") {
        if (!pattern8.test(data1)) {
          const err8 = { instancePath: instancePath + "/source_file", schemaPath: "#/$defs/repoMarkdownPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._/-]+\\.md$" }, message: 'must match pattern "^[A-Za-z0-9._/-]+\\.md$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/source_file", schemaPath: "#/$defs/repoMarkdownPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data2 = data.binding;
      if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
        if (data2.kind === void 0) {
          const err10 = { instancePath: instancePath + "/binding", schemaPath: "#/$defs/entrySurfaceBinding/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (data2.value === void 0) {
          const err11 = { instancePath: instancePath + "/binding", schemaPath: "#/$defs/entrySurfaceBinding/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
        for (const key1 in data2) {
          if (!(key1 === "kind" || key1 === "value")) {
            const err12 = { instancePath: instancePath + "/binding", schemaPath: "#/$defs/entrySurfaceBinding/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        if (data2.kind !== void 0) {
          let data3 = data2.kind;
          if (!(data3 === "marker" || data3 === "anchor")) {
            const err13 = { instancePath: instancePath + "/binding/kind", schemaPath: "#/$defs/entrySurfaceBinding/properties/kind/enum", keyword: "enum", params: { allowedValues: schema46.properties.kind.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err13];
            } else {
              vErrors.push(err13);
            }
            errors++;
          }
        }
        if (data2.value !== void 0) {
          let data4 = data2.value;
          if (typeof data4 === "string") {
            if (!pattern9.test(data4)) {
              const err14 = { instancePath: instancePath + "/binding/value", schemaPath: "#/$defs/entrySurfaceBinding/properties/value/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9._:-]*$"' };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
          } else {
            const err15 = { instancePath: instancePath + "/binding/value", schemaPath: "#/$defs/entrySurfaceBinding/properties/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
      } else {
        const err16 = { instancePath: instancePath + "/binding", schemaPath: "#/$defs/entrySurfaceBinding/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.surface_kind !== void 0) {
      let data5 = data.surface_kind;
      if (!(data5 === "command" || data5 === "skill_entry" || data5 === "agents_navigation")) {
        const err17 = { instancePath: instancePath + "/surface_kind", schemaPath: "#/properties/surface_kind/enum", keyword: "enum", params: { allowedValues: schema43.properties.surface_kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.targets !== void 0) {
      let data6 = data.targets;
      if (Array.isArray(data6)) {
        if (data6.length < 1) {
          const err18 = { instancePath: instancePath + "/targets", schemaPath: "#/properties/targets/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        const len0 = data6.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate28(data6[i0], { instancePath: instancePath + "/targets/" + i0, parentData: data6, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err19 = { instancePath: instancePath + "/targets", schemaPath: "#/properties/targets/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.lifecycle !== void 0) {
      if (!validate30(data.lifecycle, { instancePath: instancePath + "/lifecycle", parentData: data, parentDataProperty: "lifecycle", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err20 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err20];
    } else {
      vErrors.push(err20);
    }
    errors++;
  }
  validate27.errors = vErrors;
  return errors === 0;
}
validate27.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema56 = { "type": "object", "additionalProperties": false, "required": ["kind", "ref"], "properties": { "kind": { "enum": ["canonical-prose", "design", "research", "test", "migration", "review"] }, "ref": { "$ref": "#/$defs/nonEmptyString" }, "note": { "$ref": "#/$defs/nonEmptyString" } } };
function validate35(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate35.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.ref === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ref" }, message: "must have required property 'ref'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "kind" || key0 === "ref" || key0 === "note")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      let data0 = data.kind;
      if (!(data0 === "canonical-prose" || data0 === "design" || data0 === "research" || data0 === "test" || data0 === "migration" || data0 === "review")) {
        const err3 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema56.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.ref !== void 0) {
      let data1 = data.ref;
      if (typeof data1 === "string") {
        if (func3(data1) < 1) {
          const err4 = { instancePath: instancePath + "/ref", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/ref", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.note !== void 0) {
      let data2 = data.note;
      if (typeof data2 === "string") {
        if (func3(data2) < 1) {
          const err6 = { instancePath: instancePath + "/note", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/note", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
  } else {
    const err8 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err8];
    } else {
      vErrors.push(err8);
    }
    errors++;
  }
  validate35.errors = vErrors;
  return errors === 0;
}
validate35.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema59 = { "type": "object", "additionalProperties": false, "required": ["kind", "ref"], "properties": { "kind": { "enum": ["schema", "binding", "invariant", "golden", "mutation", "projection", "behavior-eval", "review"] }, "ref": { "$ref": "#/$defs/nonEmptyString" }, "host": { "$ref": "#/$defs/knownHost" } } };
function validate37(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate37.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.ref === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ref" }, message: "must have required property 'ref'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "kind" || key0 === "ref" || key0 === "host")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      let data0 = data.kind;
      if (!(data0 === "schema" || data0 === "binding" || data0 === "invariant" || data0 === "golden" || data0 === "mutation" || data0 === "projection" || data0 === "behavior-eval" || data0 === "review")) {
        const err3 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema59.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.ref !== void 0) {
      let data1 = data.ref;
      if (typeof data1 === "string") {
        if (func3(data1) < 1) {
          const err4 = { instancePath: instancePath + "/ref", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/ref", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.host !== void 0) {
      let data2 = data.host;
      if (!(data2 === "claude-code" || data2 === "codex" || data2 === "cursor" || data2 === "kimi-code")) {
        const err6 = { instancePath: instancePath + "/host", schemaPath: "#/$defs/knownHost/enum", keyword: "enum", params: { allowedValues: schema34.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate37.errors = vErrors;
  return errors === 0;
}
validate37.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate34(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate34.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.evidence === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "evidence" }, message: "must have required property 'evidence'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.verifiers === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "verifiers" }, message: "must have required property 'verifiers'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "evidence" || key0 === "verifiers")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.evidence !== void 0) {
      let data0 = data.evidence;
      if (Array.isArray(data0)) {
        if (data0.length < 1) {
          const err3 = { instancePath: instancePath + "/evidence", schemaPath: "#/properties/evidence/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        const len0 = data0.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate35(data0[i0], { instancePath: instancePath + "/evidence/" + i0, parentData: data0, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err4 = { instancePath: instancePath + "/evidence", schemaPath: "#/properties/evidence/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.verifiers !== void 0) {
      let data2 = data.verifiers;
      if (Array.isArray(data2)) {
        if (data2.length < 1) {
          const err5 = { instancePath: instancePath + "/verifiers", schemaPath: "#/properties/verifiers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        const len1 = data2.length;
        for (let i1 = 0; i1 < len1; i1++) {
          if (!validate37(data2[i1], { instancePath: instancePath + "/verifiers/" + i1, parentData: data2, parentDataProperty: i1, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate37.errors : vErrors.concat(validate37.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err6 = { instancePath: instancePath + "/verifiers", schemaPath: "#/properties/verifiers/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate34.errors = vErrors;
  return errors === 0;
}
validate34.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate24(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate24.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.label === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "label" }, message: "must have required property 'label'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.recognition_cues === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "recognition_cues" }, message: "must have required property 'recognition_cues'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.surfaces === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "surfaces" }, message: "must have required property 'surfaces'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.lifecycle === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "lifecycle" }, message: "must have required property 'lifecycle'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.admission === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "admission" }, message: "must have required property 'admission'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "label" || key0 === "recognition_cues" || key0 === "surfaces" || key0 === "lifecycle" || key0 === "admission")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern7.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/entryId/pattern", keyword: "pattern", params: { pattern: "^entry:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^entry:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/entryId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.label !== void 0) {
      let data1 = data.label;
      if (typeof data1 === "string") {
        if (func3(data1) < 1) {
          const err9 = { instancePath: instancePath + "/label", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/label", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.recognition_cues !== void 0) {
      let data2 = data.recognition_cues;
      if (!validate25(data2, { instancePath: instancePath + "/recognition_cues", parentData: data, parentDataProperty: "recognition_cues", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
      if (Array.isArray(data2)) {
        if (data2.length < 1) {
          const err11 = { instancePath: instancePath + "/recognition_cues", schemaPath: "#/properties/recognition_cues/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      }
    }
    if (data.surfaces !== void 0) {
      let data3 = data.surfaces;
      if (Array.isArray(data3)) {
        const _errs12 = errors;
        const len0 = data3.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data4 = data3[i0];
          const _errs13 = errors;
          if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
            if (data4.host === void 0) {
              const err12 = { instancePath: instancePath + "/surfaces/" + i0, schemaPath: "#/properties/surfaces/allOf/0/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err12];
              } else {
                vErrors.push(err12);
              }
              errors++;
            }
            if (data4.host !== void 0) {
              if ("claude-code" !== data4.host) {
                const err13 = { instancePath: instancePath + "/surfaces/" + i0 + "/host", schemaPath: "#/properties/surfaces/allOf/0/contains/properties/host/const", keyword: "const", params: { allowedValue: "claude-code" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err13];
                } else {
                  vErrors.push(err13);
                }
                errors++;
              }
            }
          } else {
            const err14 = { instancePath: instancePath + "/surfaces/" + i0, schemaPath: "#/properties/surfaces/allOf/0/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
          var valid4 = _errs13 === errors;
          if (valid4) {
            break;
          }
        }
        if (!valid4) {
          const err15 = { instancePath: instancePath + "/surfaces", schemaPath: "#/properties/surfaces/allOf/0/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        } else {
          errors = _errs12;
          if (vErrors !== null) {
            if (_errs12) {
              vErrors.length = _errs12;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        const _errs17 = errors;
        const len1 = data3.length;
        for (let i1 = 0; i1 < len1; i1++) {
          let data6 = data3[i1];
          const _errs18 = errors;
          if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
            if (data6.host === void 0) {
              const err16 = { instancePath: instancePath + "/surfaces/" + i1, schemaPath: "#/properties/surfaces/allOf/1/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
            if (data6.host !== void 0) {
              if ("codex" !== data6.host) {
                const err17 = { instancePath: instancePath + "/surfaces/" + i1 + "/host", schemaPath: "#/properties/surfaces/allOf/1/contains/properties/host/const", keyword: "const", params: { allowedValue: "codex" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
          } else {
            const err18 = { instancePath: instancePath + "/surfaces/" + i1, schemaPath: "#/properties/surfaces/allOf/1/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err18];
            } else {
              vErrors.push(err18);
            }
            errors++;
          }
          var valid6 = _errs18 === errors;
          if (valid6) {
            break;
          }
        }
        if (!valid6) {
          const err19 = { instancePath: instancePath + "/surfaces", schemaPath: "#/properties/surfaces/allOf/1/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        } else {
          errors = _errs17;
          if (vErrors !== null) {
            if (_errs17) {
              vErrors.length = _errs17;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        const _errs22 = errors;
        const len2 = data3.length;
        for (let i2 = 0; i2 < len2; i2++) {
          let data8 = data3[i2];
          const _errs23 = errors;
          if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
            if (data8.host === void 0) {
              const err20 = { instancePath: instancePath + "/surfaces/" + i2, schemaPath: "#/properties/surfaces/allOf/2/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
            if (data8.host !== void 0) {
              if ("cursor" !== data8.host) {
                const err21 = { instancePath: instancePath + "/surfaces/" + i2 + "/host", schemaPath: "#/properties/surfaces/allOf/2/contains/properties/host/const", keyword: "const", params: { allowedValue: "cursor" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
          } else {
            const err22 = { instancePath: instancePath + "/surfaces/" + i2, schemaPath: "#/properties/surfaces/allOf/2/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
          var valid8 = _errs23 === errors;
          if (valid8) {
            break;
          }
        }
        if (!valid8) {
          const err23 = { instancePath: instancePath + "/surfaces", schemaPath: "#/properties/surfaces/allOf/2/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        } else {
          errors = _errs22;
          if (vErrors !== null) {
            if (_errs22) {
              vErrors.length = _errs22;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        const _errs27 = errors;
        const len3 = data3.length;
        for (let i3 = 0; i3 < len3; i3++) {
          let data10 = data3[i3];
          const _errs28 = errors;
          if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
            if (data10.host === void 0) {
              const err24 = { instancePath: instancePath + "/surfaces/" + i3, schemaPath: "#/properties/surfaces/allOf/3/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
            if (data10.host !== void 0) {
              if ("kimi-code" !== data10.host) {
                const err25 = { instancePath: instancePath + "/surfaces/" + i3 + "/host", schemaPath: "#/properties/surfaces/allOf/3/contains/properties/host/const", keyword: "const", params: { allowedValue: "kimi-code" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
          } else {
            const err26 = { instancePath: instancePath + "/surfaces/" + i3, schemaPath: "#/properties/surfaces/allOf/3/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
          var valid10 = _errs28 === errors;
          if (valid10) {
            break;
          }
        }
        if (!valid10) {
          const err27 = { instancePath: instancePath + "/surfaces", schemaPath: "#/properties/surfaces/allOf/3/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err27];
          } else {
            vErrors.push(err27);
          }
          errors++;
        } else {
          errors = _errs27;
          if (vErrors !== null) {
            if (_errs27) {
              vErrors.length = _errs27;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        if (data3.length > 4) {
          const err28 = { instancePath: instancePath + "/surfaces", schemaPath: "#/properties/surfaces/maxItems", keyword: "maxItems", params: { limit: 4 }, message: "must NOT have more than 4 items" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
        if (data3.length < 4) {
          const err29 = { instancePath: instancePath + "/surfaces", schemaPath: "#/properties/surfaces/minItems", keyword: "minItems", params: { limit: 4 }, message: "must NOT have fewer than 4 items" };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
        const len4 = data3.length;
        for (let i4 = 0; i4 < len4; i4++) {
          if (!validate27(data3[i4], { instancePath: instancePath + "/surfaces/" + i4, parentData: data3, parentDataProperty: i4, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err30 = { instancePath: instancePath + "/surfaces", schemaPath: "#/properties/surfaces/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err30];
        } else {
          vErrors.push(err30);
        }
        errors++;
      }
    }
    if (data.lifecycle !== void 0) {
      if (!validate30(data.lifecycle, { instancePath: instancePath + "/lifecycle", parentData: data, parentDataProperty: "lifecycle", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
        errors = vErrors.length;
      }
    }
    if (data.admission !== void 0) {
      if (!validate34(data.admission, { instancePath: instancePath + "/admission", parentData: data, parentDataProperty: "admission", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err31 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err31];
    } else {
      vErrors.push(err31);
    }
    errors++;
  }
  validate24.errors = vErrors;
  return errors === 0;
}
validate24.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schema_version === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.runtime_hosts === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtime_hosts" }, message: "must have required property 'runtime_hosts'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.skills === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "skills" }, message: "must have required property 'skills'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.entries === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entries" }, message: "must have required property 'entries'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.hop_policy === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "hop_policy" }, message: "must have required property 'hop_policy'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.critical_pin_budget === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "critical_pin_budget" }, message: "must have required property 'critical_pin_budget'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.router_budget === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "router_budget" }, message: "must have required property 'router_budget'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.rollout === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rollout" }, message: "must have required property 'rollout'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema32.properties, key0)) {
        const err10 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0) {
      if ("cc-master/skill-knowledge-source/v1alpha1" !== data.schema_version) {
        const err11 = { instancePath: instancePath + "/schema_version", schemaPath: "#/$defs/schemaVersion/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-source/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      if ("portfolio" !== data.kind) {
        const err12 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "portfolio" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern4.test(data2)) {
          const err13 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^portfolio:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^portfolio:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.runtime_hosts !== void 0) {
      let data3 = data.runtime_hosts;
      if (Array.isArray(data3)) {
        const _errs10 = errors;
        const len0 = data3.length;
        for (let i0 = 0; i0 < len0; i0++) {
          const _errs11 = errors;
          if ("claude-code" !== data3[i0]) {
            const err15 = { instancePath: instancePath + "/runtime_hosts/" + i0, schemaPath: "#/properties/runtime_hosts/allOf/0/contains/const", keyword: "const", params: { allowedValue: "claude-code" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
          var valid3 = _errs11 === errors;
          if (valid3) {
            break;
          }
        }
        if (!valid3) {
          const err16 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/allOf/0/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        } else {
          errors = _errs10;
          if (vErrors !== null) {
            if (_errs10) {
              vErrors.length = _errs10;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        const _errs13 = errors;
        const len1 = data3.length;
        for (let i1 = 0; i1 < len1; i1++) {
          const _errs14 = errors;
          if ("codex" !== data3[i1]) {
            const err17 = { instancePath: instancePath + "/runtime_hosts/" + i1, schemaPath: "#/properties/runtime_hosts/allOf/1/contains/const", keyword: "const", params: { allowedValue: "codex" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
          var valid4 = _errs14 === errors;
          if (valid4) {
            break;
          }
        }
        if (!valid4) {
          const err18 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/allOf/1/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        } else {
          errors = _errs13;
          if (vErrors !== null) {
            if (_errs13) {
              vErrors.length = _errs13;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        const _errs16 = errors;
        const len2 = data3.length;
        for (let i2 = 0; i2 < len2; i2++) {
          const _errs17 = errors;
          if ("cursor" !== data3[i2]) {
            const err19 = { instancePath: instancePath + "/runtime_hosts/" + i2, schemaPath: "#/properties/runtime_hosts/allOf/2/contains/const", keyword: "const", params: { allowedValue: "cursor" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
          var valid5 = _errs17 === errors;
          if (valid5) {
            break;
          }
        }
        if (!valid5) {
          const err20 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/allOf/2/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        } else {
          errors = _errs16;
          if (vErrors !== null) {
            if (_errs16) {
              vErrors.length = _errs16;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        const _errs19 = errors;
        const len3 = data3.length;
        for (let i3 = 0; i3 < len3; i3++) {
          const _errs20 = errors;
          if ("kimi-code" !== data3[i3]) {
            const err21 = { instancePath: instancePath + "/runtime_hosts/" + i3, schemaPath: "#/properties/runtime_hosts/allOf/3/contains/const", keyword: "const", params: { allowedValue: "kimi-code" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          }
          var valid6 = _errs20 === errors;
          if (valid6) {
            break;
          }
        }
        if (!valid6) {
          const err22 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/allOf/3/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        } else {
          errors = _errs19;
          if (vErrors !== null) {
            if (_errs19) {
              vErrors.length = _errs19;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data3)) {
        if (data3.length > 4) {
          const err23 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/maxItems", keyword: "maxItems", params: { limit: 4 }, message: "must NOT have more than 4 items" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
        if (data3.length < 4) {
          const err24 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/minItems", keyword: "minItems", params: { limit: 4 }, message: "must NOT have fewer than 4 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len4 = data3.length;
        for (let i4 = 0; i4 < len4; i4++) {
          let data8 = data3[i4];
          if (!(data8 === "claude-code" || data8 === "codex" || data8 === "cursor" || data8 === "kimi-code")) {
            const err25 = { instancePath: instancePath + "/runtime_hosts/" + i4, schemaPath: "#/$defs/knownHost/enum", keyword: "enum", params: { allowedValues: schema34.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
        let i5 = data3.length;
        let j0;
        if (i5 > 1) {
          outer0: for (; i5--; ) {
            for (j0 = i5; j0--; ) {
              if (func0(data3[i5], data3[j0])) {
                const err26 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/uniqueItems", keyword: "uniqueItems", params: { i: i5, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i5 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err26];
                } else {
                  vErrors.push(err26);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/runtime_hosts", schemaPath: "#/properties/runtime_hosts/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.skills !== void 0) {
      let data9 = data.skills;
      if (Array.isArray(data9)) {
        if (data9.length < 1) {
          const err28 = { instancePath: instancePath + "/skills", schemaPath: "#/properties/skills/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
        const len5 = data9.length;
        for (let i6 = 0; i6 < len5; i6++) {
          if (!validate22(data9[i6], { instancePath: instancePath + "/skills/" + i6, parentData: data9, parentDataProperty: i6, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err29 = { instancePath: instancePath + "/skills", schemaPath: "#/properties/skills/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.entries !== void 0) {
      let data11 = data.entries;
      if (Array.isArray(data11)) {
        if (data11.length < 1) {
          const err30 = { instancePath: instancePath + "/entries", schemaPath: "#/properties/entries/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len6 = data11.length;
        for (let i7 = 0; i7 < len6; i7++) {
          if (!validate24(data11[i7], { instancePath: instancePath + "/entries/" + i7, parentData: data11, parentDataProperty: i7, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err31 = { instancePath: instancePath + "/entries", schemaPath: "#/properties/entries/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.hop_policy !== void 0) {
      let data13 = data.hop_policy;
      if (data13 && typeof data13 == "object" && !Array.isArray(data13)) {
        if (data13.point_diameter_max === void 0) {
          const err32 = { instancePath: instancePath + "/hop_policy", schemaPath: "#/$defs/hopPolicy/required", keyword: "required", params: { missingProperty: "point_diameter_max" }, message: "must have required property 'point_diameter_max'" };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
        if (data13.entry_discovery_max === void 0) {
          const err33 = { instancePath: instancePath + "/hop_policy", schemaPath: "#/$defs/hopPolicy/required", keyword: "required", params: { missingProperty: "entry_discovery_max" }, message: "must have required property 'entry_discovery_max'" };
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
        if (data13.critical_entry_to_primary_max === void 0) {
          const err34 = { instancePath: instancePath + "/hop_policy", schemaPath: "#/$defs/hopPolicy/required", keyword: "required", params: { missingProperty: "critical_entry_to_primary_max" }, message: "must have required property 'critical_entry_to_primary_max'" };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
        if (data13.critical_any_point_to_primary_max === void 0) {
          const err35 = { instancePath: instancePath + "/hop_policy", schemaPath: "#/$defs/hopPolicy/required", keyword: "required", params: { missingProperty: "critical_any_point_to_primary_max" }, message: "must have required property 'critical_any_point_to_primary_max'" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
        if (data13.primary_entry_to_primary_max === void 0) {
          const err36 = { instancePath: instancePath + "/hop_policy", schemaPath: "#/$defs/hopPolicy/required", keyword: "required", params: { missingProperty: "primary_entry_to_primary_max" }, message: "must have required property 'primary_entry_to_primary_max'" };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
        for (const key1 in data13) {
          if (!(key1 === "point_diameter_max" || key1 === "entry_discovery_max" || key1 === "critical_entry_to_primary_max" || key1 === "critical_any_point_to_primary_max" || key1 === "primary_entry_to_primary_max")) {
            const err37 = { instancePath: instancePath + "/hop_policy", schemaPath: "#/$defs/hopPolicy/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err37];
            } else {
              vErrors.push(err37);
            }
            errors++;
          }
        }
        if (data13.point_diameter_max !== void 0) {
          if (3 !== data13.point_diameter_max) {
            const err38 = { instancePath: instancePath + "/hop_policy/point_diameter_max", schemaPath: "#/$defs/hopPolicy/properties/point_diameter_max/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err38];
            } else {
              vErrors.push(err38);
            }
            errors++;
          }
        }
        if (data13.entry_discovery_max !== void 0) {
          if (3 !== data13.entry_discovery_max) {
            const err39 = { instancePath: instancePath + "/hop_policy/entry_discovery_max", schemaPath: "#/$defs/hopPolicy/properties/entry_discovery_max/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
        }
        if (data13.critical_entry_to_primary_max !== void 0) {
          if (1 !== data13.critical_entry_to_primary_max) {
            const err40 = { instancePath: instancePath + "/hop_policy/critical_entry_to_primary_max", schemaPath: "#/$defs/hopPolicy/properties/critical_entry_to_primary_max/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err40];
            } else {
              vErrors.push(err40);
            }
            errors++;
          }
        }
        if (data13.critical_any_point_to_primary_max !== void 0) {
          if (2 !== data13.critical_any_point_to_primary_max) {
            const err41 = { instancePath: instancePath + "/hop_policy/critical_any_point_to_primary_max", schemaPath: "#/$defs/hopPolicy/properties/critical_any_point_to_primary_max/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err41];
            } else {
              vErrors.push(err41);
            }
            errors++;
          }
        }
        if (data13.primary_entry_to_primary_max !== void 0) {
          if (2 !== data13.primary_entry_to_primary_max) {
            const err42 = { instancePath: instancePath + "/hop_policy/primary_entry_to_primary_max", schemaPath: "#/$defs/hopPolicy/properties/primary_entry_to_primary_max/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
      } else {
        const err43 = { instancePath: instancePath + "/hop_policy", schemaPath: "#/$defs/hopPolicy/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err43];
        } else {
          vErrors.push(err43);
        }
        errors++;
      }
    }
    if (data.critical_pin_budget !== void 0) {
      let data19 = data.critical_pin_budget;
      if (data19 && typeof data19 == "object" && !Array.isArray(data19)) {
        if (data19.max_modules === void 0) {
          const err44 = { instancePath: instancePath + "/critical_pin_budget", schemaPath: "#/$defs/pinBudget/required", keyword: "required", params: { missingProperty: "max_modules" }, message: "must have required property 'max_modules'" };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
        if (data19.max_fraction === void 0) {
          const err45 = { instancePath: instancePath + "/critical_pin_budget", schemaPath: "#/$defs/pinBudget/required", keyword: "required", params: { missingProperty: "max_fraction" }, message: "must have required property 'max_fraction'" };
          if (vErrors === null) {
            vErrors = [err45];
          } else {
            vErrors.push(err45);
          }
          errors++;
        }
        for (const key2 in data19) {
          if (!(key2 === "max_modules" || key2 === "max_fraction")) {
            const err46 = { instancePath: instancePath + "/critical_pin_budget", schemaPath: "#/$defs/pinBudget/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err46];
            } else {
              vErrors.push(err46);
            }
            errors++;
          }
        }
        if (data19.max_modules !== void 0) {
          let data20 = data19.max_modules;
          if (!(typeof data20 == "number" && (!(data20 % 1) && !isNaN(data20)))) {
            const err47 = { instancePath: instancePath + "/critical_pin_budget/max_modules", schemaPath: "#/$defs/pinBudget/properties/max_modules/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err47];
            } else {
              vErrors.push(err47);
            }
            errors++;
          }
          if (typeof data20 == "number") {
            if (data20 < 1 || isNaN(data20)) {
              const err48 = { instancePath: instancePath + "/critical_pin_budget/max_modules", schemaPath: "#/$defs/pinBudget/properties/max_modules/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
          }
        }
        if (data19.max_fraction !== void 0) {
          let data21 = data19.max_fraction;
          if (typeof data21 == "number") {
            if (data21 > 1 || isNaN(data21)) {
              const err49 = { instancePath: instancePath + "/critical_pin_budget/max_fraction", schemaPath: "#/$defs/pinBudget/properties/max_fraction/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1 }, message: "must be <= 1" };
              if (vErrors === null) {
                vErrors = [err49];
              } else {
                vErrors.push(err49);
              }
              errors++;
            }
            if (data21 <= 0 || isNaN(data21)) {
              const err50 = { instancePath: instancePath + "/critical_pin_budget/max_fraction", schemaPath: "#/$defs/pinBudget/properties/max_fraction/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
              if (vErrors === null) {
                vErrors = [err50];
              } else {
                vErrors.push(err50);
              }
              errors++;
            }
          } else {
            const err51 = { instancePath: instancePath + "/critical_pin_budget/max_fraction", schemaPath: "#/$defs/pinBudget/properties/max_fraction/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            if (vErrors === null) {
              vErrors = [err51];
            } else {
              vErrors.push(err51);
            }
            errors++;
          }
        }
      } else {
        const err52 = { instancePath: instancePath + "/critical_pin_budget", schemaPath: "#/$defs/pinBudget/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err52];
        } else {
          vErrors.push(err52);
        }
        errors++;
      }
    }
    if (data.router_budget !== void 0) {
      let data22 = data.router_budget;
      if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
        if (data22.atlas_max_lines === void 0) {
          const err53 = { instancePath: instancePath + "/router_budget", schemaPath: "#/$defs/routerBudget/required", keyword: "required", params: { missingProperty: "atlas_max_lines" }, message: "must have required property 'atlas_max_lines'" };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
        if (data22.atlas_max_tokens === void 0) {
          const err54 = { instancePath: instancePath + "/router_budget", schemaPath: "#/$defs/routerBudget/required", keyword: "required", params: { missingProperty: "atlas_max_tokens" }, message: "must have required property 'atlas_max_tokens'" };
          if (vErrors === null) {
            vErrors = [err54];
          } else {
            vErrors.push(err54);
          }
          errors++;
        }
        if (data22.module_max_lines === void 0) {
          const err55 = { instancePath: instancePath + "/router_budget", schemaPath: "#/$defs/routerBudget/required", keyword: "required", params: { missingProperty: "module_max_lines" }, message: "must have required property 'module_max_lines'" };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
        if (data22.module_max_tokens === void 0) {
          const err56 = { instancePath: instancePath + "/router_budget", schemaPath: "#/$defs/routerBudget/required", keyword: "required", params: { missingProperty: "module_max_tokens" }, message: "must have required property 'module_max_tokens'" };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
        if (data22.point_nav_max_lines === void 0) {
          const err57 = { instancePath: instancePath + "/router_budget", schemaPath: "#/$defs/routerBudget/required", keyword: "required", params: { missingProperty: "point_nav_max_lines" }, message: "must have required property 'point_nav_max_lines'" };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
        for (const key3 in data22) {
          if (!(key3 === "atlas_max_lines" || key3 === "atlas_max_tokens" || key3 === "module_max_lines" || key3 === "module_max_tokens" || key3 === "point_nav_max_lines")) {
            const err58 = { instancePath: instancePath + "/router_budget", schemaPath: "#/$defs/routerBudget/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err58];
            } else {
              vErrors.push(err58);
            }
            errors++;
          }
        }
        if (data22.atlas_max_lines !== void 0) {
          let data23 = data22.atlas_max_lines;
          if (!(typeof data23 == "number" && (!(data23 % 1) && !isNaN(data23)))) {
            const err59 = { instancePath: instancePath + "/router_budget/atlas_max_lines", schemaPath: "#/$defs/routerBudget/properties/atlas_max_lines/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err59];
            } else {
              vErrors.push(err59);
            }
            errors++;
          }
          if (typeof data23 == "number") {
            if (data23 < 1 || isNaN(data23)) {
              const err60 = { instancePath: instancePath + "/router_budget/atlas_max_lines", schemaPath: "#/$defs/routerBudget/properties/atlas_max_lines/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err60];
              } else {
                vErrors.push(err60);
              }
              errors++;
            }
          }
        }
        if (data22.atlas_max_tokens !== void 0) {
          let data24 = data22.atlas_max_tokens;
          if (!(typeof data24 == "number" && (!(data24 % 1) && !isNaN(data24)))) {
            const err61 = { instancePath: instancePath + "/router_budget/atlas_max_tokens", schemaPath: "#/$defs/routerBudget/properties/atlas_max_tokens/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
          if (typeof data24 == "number") {
            if (data24 < 1 || isNaN(data24)) {
              const err62 = { instancePath: instancePath + "/router_budget/atlas_max_tokens", schemaPath: "#/$defs/routerBudget/properties/atlas_max_tokens/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err62];
              } else {
                vErrors.push(err62);
              }
              errors++;
            }
          }
        }
        if (data22.module_max_lines !== void 0) {
          let data25 = data22.module_max_lines;
          if (!(typeof data25 == "number" && (!(data25 % 1) && !isNaN(data25)))) {
            const err63 = { instancePath: instancePath + "/router_budget/module_max_lines", schemaPath: "#/$defs/routerBudget/properties/module_max_lines/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
          if (typeof data25 == "number") {
            if (data25 < 1 || isNaN(data25)) {
              const err64 = { instancePath: instancePath + "/router_budget/module_max_lines", schemaPath: "#/$defs/routerBudget/properties/module_max_lines/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
            }
          }
        }
        if (data22.module_max_tokens !== void 0) {
          let data26 = data22.module_max_tokens;
          if (!(typeof data26 == "number" && (!(data26 % 1) && !isNaN(data26)))) {
            const err65 = { instancePath: instancePath + "/router_budget/module_max_tokens", schemaPath: "#/$defs/routerBudget/properties/module_max_tokens/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err65];
            } else {
              vErrors.push(err65);
            }
            errors++;
          }
          if (typeof data26 == "number") {
            if (data26 < 1 || isNaN(data26)) {
              const err66 = { instancePath: instancePath + "/router_budget/module_max_tokens", schemaPath: "#/$defs/routerBudget/properties/module_max_tokens/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
          }
        }
        if (data22.point_nav_max_lines !== void 0) {
          let data27 = data22.point_nav_max_lines;
          if (!(typeof data27 == "number" && (!(data27 % 1) && !isNaN(data27)))) {
            const err67 = { instancePath: instancePath + "/router_budget/point_nav_max_lines", schemaPath: "#/$defs/routerBudget/properties/point_nav_max_lines/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          }
          if (typeof data27 == "number") {
            if (data27 < 1 || isNaN(data27)) {
              const err68 = { instancePath: instancePath + "/router_budget/point_nav_max_lines", schemaPath: "#/$defs/routerBudget/properties/point_nav_max_lines/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
          }
        }
      } else {
        const err69 = { instancePath: instancePath + "/router_budget", schemaPath: "#/$defs/routerBudget/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err69];
        } else {
          vErrors.push(err69);
        }
        errors++;
      }
    }
    if (data.rollout !== void 0) {
      let data28 = data.rollout;
      if (!(data28 === "K0" || data28 === "K1" || data28 === "K2" || data28 === "K3")) {
        const err70 = { instancePath: instancePath + "/rollout", schemaPath: "#/properties/rollout/enum", keyword: "enum", params: { allowedValues: schema32.properties.rollout.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err70];
        } else {
          vErrors.push(err70);
        }
        errors++;
      }
    }
  } else {
    const err71 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err71];
    } else {
      vErrors.push(err71);
    }
    errors++;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema65 = { "type": "object", "additionalProperties": false, "required": ["schema_version", "kind", "id", "name", "package_root", "intent", "modules", "entry_modules", "canonical_source_inventory", "host_coverage", "lifecycle", "admission"], "properties": { "schema_version": { "$ref": "#/$defs/schemaVersion" }, "kind": { "const": "skill" }, "id": { "$ref": "#/$defs/skillId" }, "name": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" }, "package_root": { "type": "string", "pattern": "^plugin/src/skills/[a-z0-9-]+$" }, "intent": { "$ref": "#/$defs/nonEmptyString" }, "modules": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/moduleRef" } }, "entry_modules": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/moduleId" }, "uniqueItems": true }, "canonical_source_inventory": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/sourceInventoryEntry" } }, "host_coverage": { "type": "array", "minItems": 4, "maxItems": 4, "items": { "$ref": "#/$defs/hostCoverage" }, "allOf": [{ "contains": { "type": "object", "required": ["host"], "properties": { "host": { "const": "claude-code" } } } }, { "contains": { "type": "object", "required": ["host"], "properties": { "host": { "const": "codex" } } } }, { "contains": { "type": "object", "required": ["host"], "properties": { "host": { "const": "cursor" } } } }, { "contains": { "type": "object", "required": ["host"], "properties": { "host": { "const": "kimi-code" } } } }] }, "lifecycle": { "$ref": "#/$defs/lifecycle" }, "admission": { "$ref": "#/$defs/admission" } } };
var pattern15 = new RegExp("^[a-z0-9]+(?:-[a-z0-9]+)*$", "u");
var pattern16 = new RegExp("^plugin/src/skills/[a-z0-9-]+$", "u");
function validate43(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate43.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.manifest === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "manifest" }, message: "must have required property 'manifest'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "manifest")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern11.test(data0)) {
          const err3 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/moduleId/pattern", keyword: "pattern", params: { pattern: "^module:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^module:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/moduleId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.manifest !== void 0) {
      let data1 = data.manifest;
      if (typeof data1 === "string") {
        if (!pattern6.test(data1)) {
          const err5 = { instancePath: instancePath + "/manifest", schemaPath: "#/$defs/repoJsonPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._/-]+\\.json$" }, message: 'must match pattern "^[A-Za-z0-9._/-]+\\.json$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/manifest", schemaPath: "#/$defs/repoJsonPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate43.errors = vErrors;
  return errors === 0;
}
validate43.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema73 = { "type": "object", "additionalProperties": false, "required": ["path", "coverage", "point_ids", "reviewed_unbound_sha256"], "properties": { "path": { "$ref": "#/$defs/repoMarkdownPath" }, "coverage": { "enum": ["full", "partial", "non_knowledge", "excluded"] }, "point_ids": { "type": "array", "items": { "$ref": "#/$defs/pointId" }, "uniqueItems": true }, "reviewed_unbound_sha256": { "$ref": "#/$defs/sha256" }, "unresolved_coverage_debt": { "type": "array", "items": { "$ref": "#/$defs/nonEmptyString" }, "uniqueItems": true }, "review": { "$ref": "#/$defs/inventoryReview" } }, "allOf": [{ "if": { "properties": { "coverage": { "const": "partial" } }, "required": ["coverage"] }, "then": { "required": ["unresolved_coverage_debt"], "properties": { "unresolved_coverage_debt": { "minItems": 1 } } } }, { "if": { "properties": { "coverage": { "enum": ["non_knowledge", "excluded"] } }, "required": ["coverage"] }, "then": { "required": ["review"], "properties": { "point_ids": { "maxItems": 0 } } } }] };
var pattern22 = new RegExp("^[a-f0-9]{64}$", "u");
function validate46(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate46.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.reviewer === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reviewer" }, message: "must have required property 'reviewer'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "reviewer" || key0 === "rationale")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.reviewer !== void 0) {
      let data0 = data.reviewer;
      if (typeof data0 === "string") {
        if (func3(data0) < 1) {
          const err3 = { instancePath: instancePath + "/reviewer", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/reviewer", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data1 = data.rationale;
      if (typeof data1 === "string") {
        if (func3(data1) < 1) {
          const err5 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate46.errors = vErrors;
  return errors === 0;
}
validate46.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate45(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate45.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing0;
    if (data.coverage === void 0 && (missing0 = "coverage")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.coverage !== void 0) {
        if ("partial" !== data.coverage) {
          const err1 = {};
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.unresolved_coverage_debt === void 0) {
        const err2 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "unresolved_coverage_debt" }, message: "must have required property 'unresolved_coverage_debt'" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.unresolved_coverage_debt !== void 0) {
        let data1 = data.unresolved_coverage_debt;
        if (Array.isArray(data1)) {
          if (data1.length < 1) {
            const err3 = { instancePath: instancePath + "/unresolved_coverage_debt", schemaPath: "#/allOf/0/then/properties/unresolved_coverage_debt/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.unresolved_coverage_debt = true;
      props0.coverage = true;
    }
  }
  if (!valid1) {
    const err4 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
  }
  const _errs8 = errors;
  let valid4 = true;
  const _errs9 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing1;
    if (data.coverage === void 0 && (missing1 = "coverage")) {
      const err5 = {};
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    } else {
      if (data.coverage !== void 0) {
        let data2 = data.coverage;
        if (!(data2 === "non_knowledge" || data2 === "excluded")) {
          const err6 = {};
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
    }
  }
  var _valid1 = _errs9 === errors;
  errors = _errs8;
  if (vErrors !== null) {
    if (_errs8) {
      vErrors.length = _errs8;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs11 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.review === void 0) {
        const err7 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "review" }, message: "must have required property 'review'" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
      if (data.point_ids !== void 0) {
        let data3 = data.point_ids;
        if (Array.isArray(data3)) {
          if (data3.length > 0) {
            const err8 = { instancePath: instancePath + "/point_ids", schemaPath: "#/allOf/1/then/properties/point_ids/maxItems", keyword: "maxItems", params: { limit: 0 }, message: "must NOT have more than 0 items" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
      }
    }
    var _valid1 = _errs11 === errors;
    valid4 = _valid1;
    if (valid4) {
      var props1 = {};
      props1.point_ids = true;
      props1.coverage = true;
    }
  }
  if (!valid4) {
    const err9 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err9];
    } else {
      vErrors.push(err9);
    }
    errors++;
  }
  if (props0 !== true && props1 !== void 0) {
    if (props1 === true) {
      props0 = true;
    } else {
      props0 = props0 || {};
      Object.assign(props0, props1);
    }
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.path === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.coverage === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "coverage" }, message: "must have required property 'coverage'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    if (data.point_ids === void 0) {
      const err12 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "point_ids" }, message: "must have required property 'point_ids'" };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    if (data.reviewed_unbound_sha256 === void 0) {
      const err13 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reviewed_unbound_sha256" }, message: "must have required property 'reviewed_unbound_sha256'" };
      if (vErrors === null) {
        vErrors = [err13];
      } else {
        vErrors.push(err13);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "path" || key0 === "coverage" || key0 === "point_ids" || key0 === "reviewed_unbound_sha256" || key0 === "unresolved_coverage_debt" || key0 === "review")) {
        const err14 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.path !== void 0) {
      let data4 = data.path;
      if (typeof data4 === "string") {
        if (!pattern8.test(data4)) {
          const err15 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoMarkdownPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._/-]+\\.md$" }, message: 'must match pattern "^[A-Za-z0-9._/-]+\\.md$"' };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoMarkdownPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.coverage !== void 0) {
      let data5 = data.coverage;
      if (!(data5 === "full" || data5 === "partial" || data5 === "non_knowledge" || data5 === "excluded")) {
        const err17 = { instancePath: instancePath + "/coverage", schemaPath: "#/properties/coverage/enum", keyword: "enum", params: { allowedValues: schema73.properties.coverage.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.point_ids !== void 0) {
      let data6 = data.point_ids;
      if (Array.isArray(data6)) {
        const len0 = data6.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data7 = data6[i0];
          if (typeof data7 === "string") {
            if (!pattern12.test(data7)) {
              const err18 = { instancePath: instancePath + "/point_ids/" + i0, schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
          } else {
            const err19 = { instancePath: instancePath + "/point_ids/" + i0, schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
        }
        let i1 = data6.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data6[i1], data6[j0])) {
                const err20 = { instancePath: instancePath + "/point_ids", schemaPath: "#/properties/point_ids/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err20];
                } else {
                  vErrors.push(err20);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err21 = { instancePath: instancePath + "/point_ids", schemaPath: "#/properties/point_ids/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.reviewed_unbound_sha256 !== void 0) {
      let data8 = data.reviewed_unbound_sha256;
      if (typeof data8 === "string") {
        if (!pattern22.test(data8)) {
          const err22 = { instancePath: instancePath + "/reviewed_unbound_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
      } else {
        const err23 = { instancePath: instancePath + "/reviewed_unbound_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.unresolved_coverage_debt !== void 0) {
      let data9 = data.unresolved_coverage_debt;
      if (Array.isArray(data9)) {
        const len1 = data9.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data10 = data9[i2];
          if (typeof data10 === "string") {
            if (func3(data10) < 1) {
              const err24 = { instancePath: instancePath + "/unresolved_coverage_debt/" + i2, schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          } else {
            const err25 = { instancePath: instancePath + "/unresolved_coverage_debt/" + i2, schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
        let i3 = data9.length;
        let j1;
        if (i3 > 1) {
          outer1: for (; i3--; ) {
            for (j1 = i3; j1--; ) {
              if (func0(data9[i3], data9[j1])) {
                const err26 = { instancePath: instancePath + "/unresolved_coverage_debt", schemaPath: "#/properties/unresolved_coverage_debt/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i3 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err26];
                } else {
                  vErrors.push(err26);
                }
                errors++;
                break outer1;
              }
            }
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/unresolved_coverage_debt", schemaPath: "#/properties/unresolved_coverage_debt/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.review !== void 0) {
      if (!validate46(data.review, { instancePath: instancePath + "/review", parentData: data, parentDataProperty: "review", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate46.errors : vErrors.concat(validate46.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err28 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err28];
    } else {
      vErrors.push(err28);
    }
    errors++;
  }
  validate45.errors = vErrors;
  return errors === 0;
}
validate45.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema81 = { "type": "object", "additionalProperties": false, "required": ["host", "state"], "properties": { "host": { "$ref": "#/$defs/knownHost" }, "state": { "enum": ["full", "partial", "stub", "unsupported"] }, "covered_modules": { "type": "array", "items": { "$ref": "#/$defs/moduleId" }, "uniqueItems": true }, "reason": { "$ref": "#/$defs/nonEmptyString" } }, "allOf": [{ "if": { "properties": { "state": { "enum": ["stub", "unsupported"] } }, "required": ["state"] }, "then": { "required": ["reason"] } }, { "if": { "properties": { "state": { "const": "partial" } }, "required": ["state"] }, "then": { "required": ["covered_modules", "reason"], "properties": { "covered_modules": { "minItems": 1 } } } }] };
function validate49(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate49.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing0;
    if (data.state === void 0 && (missing0 = "state")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.state !== void 0) {
        let data0 = data.state;
        if (!(data0 === "stub" || data0 === "unsupported")) {
          const err1 = {};
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.reason === void 0) {
        const err2 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err3 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  const _errs7 = errors;
  let valid3 = true;
  const _errs8 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing1;
    if (data.state === void 0 && (missing1 = "state")) {
      const err4 = {};
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    } else {
      if (data.state !== void 0) {
        if ("partial" !== data.state) {
          const err5 = {};
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      }
    }
  }
  var _valid1 = _errs8 === errors;
  errors = _errs7;
  if (vErrors !== null) {
    if (_errs7) {
      vErrors.length = _errs7;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs10 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.covered_modules === void 0) {
        const err6 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "covered_modules" }, message: "must have required property 'covered_modules'" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      if (data.reason === void 0) {
        const err7 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
      if (data.covered_modules !== void 0) {
        let data2 = data.covered_modules;
        if (Array.isArray(data2)) {
          if (data2.length < 1) {
            const err8 = { instancePath: instancePath + "/covered_modules", schemaPath: "#/allOf/1/then/properties/covered_modules/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
      }
    }
    var _valid1 = _errs10 === errors;
    valid3 = _valid1;
    if (valid3) {
      var props0 = {};
      props0.covered_modules = true;
      props0.state = true;
    }
  }
  if (!valid3) {
    const err9 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err9];
    } else {
      vErrors.push(err9);
    }
    errors++;
  }
  if (props0 !== true) {
    props0 = props0 || {};
    props0.state = true;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.host === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.state === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "host" || key0 === "state" || key0 === "covered_modules" || key0 === "reason")) {
        const err12 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.host !== void 0) {
      let data3 = data.host;
      if (!(data3 === "claude-code" || data3 === "codex" || data3 === "cursor" || data3 === "kimi-code")) {
        const err13 = { instancePath: instancePath + "/host", schemaPath: "#/$defs/knownHost/enum", keyword: "enum", params: { allowedValues: schema34.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.state !== void 0) {
      let data4 = data.state;
      if (!(data4 === "full" || data4 === "partial" || data4 === "stub" || data4 === "unsupported")) {
        const err14 = { instancePath: instancePath + "/state", schemaPath: "#/properties/state/enum", keyword: "enum", params: { allowedValues: schema81.properties.state.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.covered_modules !== void 0) {
      let data5 = data.covered_modules;
      if (Array.isArray(data5)) {
        const len0 = data5.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data6 = data5[i0];
          if (typeof data6 === "string") {
            if (!pattern11.test(data6)) {
              const err15 = { instancePath: instancePath + "/covered_modules/" + i0, schemaPath: "#/$defs/moduleId/pattern", keyword: "pattern", params: { pattern: "^module:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^module:[a-z0-9][a-z0-9.-]*$"' };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
          } else {
            const err16 = { instancePath: instancePath + "/covered_modules/" + i0, schemaPath: "#/$defs/moduleId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
        let i1 = data5.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data5[i1], data5[j0])) {
                const err17 = { instancePath: instancePath + "/covered_modules", schemaPath: "#/properties/covered_modules/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err18 = { instancePath: instancePath + "/covered_modules", schemaPath: "#/properties/covered_modules/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.reason !== void 0) {
      let data7 = data.reason;
      if (typeof data7 === "string") {
        if (func3(data7) < 1) {
          const err19 = { instancePath: instancePath + "/reason", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      } else {
        const err20 = { instancePath: instancePath + "/reason", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
  } else {
    const err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err21];
    } else {
      vErrors.push(err21);
    }
    errors++;
  }
  validate49.errors = vErrors;
  return errors === 0;
}
validate49.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate42(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate42.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schema_version === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.package_root === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "package_root" }, message: "must have required property 'package_root'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.intent === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "intent" }, message: "must have required property 'intent'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.modules === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "modules" }, message: "must have required property 'modules'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.entry_modules === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry_modules" }, message: "must have required property 'entry_modules'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.canonical_source_inventory === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "canonical_source_inventory" }, message: "must have required property 'canonical_source_inventory'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.host_coverage === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "host_coverage" }, message: "must have required property 'host_coverage'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.lifecycle === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "lifecycle" }, message: "must have required property 'lifecycle'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.admission === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "admission" }, message: "must have required property 'admission'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema65.properties, key0)) {
        const err12 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0) {
      if ("cc-master/skill-knowledge-source/v1alpha1" !== data.schema_version) {
        const err13 = { instancePath: instancePath + "/schema_version", schemaPath: "#/$defs/schemaVersion/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-source/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      if ("skill" !== data.kind) {
        const err14 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "skill" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern5.test(data2)) {
          const err15 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/skillId/pattern", keyword: "pattern", params: { pattern: "^skill:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^skill:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/skillId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (!pattern15.test(data3)) {
          const err17 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }, message: 'must match pattern "^[a-z0-9]+(?:-[a-z0-9]+)*$"' };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      } else {
        const err18 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.package_root !== void 0) {
      let data4 = data.package_root;
      if (typeof data4 === "string") {
        if (!pattern16.test(data4)) {
          const err19 = { instancePath: instancePath + "/package_root", schemaPath: "#/properties/package_root/pattern", keyword: "pattern", params: { pattern: "^plugin/src/skills/[a-z0-9-]+$" }, message: 'must match pattern "^plugin/src/skills/[a-z0-9-]+$"' };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      } else {
        const err20 = { instancePath: instancePath + "/package_root", schemaPath: "#/properties/package_root/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.intent !== void 0) {
      let data5 = data.intent;
      if (typeof data5 === "string") {
        if (func3(data5) < 1) {
          const err21 = { instancePath: instancePath + "/intent", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
      } else {
        const err22 = { instancePath: instancePath + "/intent", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.modules !== void 0) {
      let data6 = data.modules;
      if (Array.isArray(data6)) {
        if (data6.length < 1) {
          const err23 = { instancePath: instancePath + "/modules", schemaPath: "#/properties/modules/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
        const len0 = data6.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate43(data6[i0], { instancePath: instancePath + "/modules/" + i0, parentData: data6, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err24 = { instancePath: instancePath + "/modules", schemaPath: "#/properties/modules/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.entry_modules !== void 0) {
      let data8 = data.entry_modules;
      if (Array.isArray(data8)) {
        if (data8.length < 1) {
          const err25 = { instancePath: instancePath + "/entry_modules", schemaPath: "#/properties/entry_modules/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
        const len1 = data8.length;
        for (let i1 = 0; i1 < len1; i1++) {
          let data9 = data8[i1];
          if (typeof data9 === "string") {
            if (!pattern11.test(data9)) {
              const err26 = { instancePath: instancePath + "/entry_modules/" + i1, schemaPath: "#/$defs/moduleId/pattern", keyword: "pattern", params: { pattern: "^module:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^module:[a-z0-9][a-z0-9.-]*$"' };
              if (vErrors === null) {
                vErrors = [err26];
              } else {
                vErrors.push(err26);
              }
              errors++;
            }
          } else {
            const err27 = { instancePath: instancePath + "/entry_modules/" + i1, schemaPath: "#/$defs/moduleId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err27];
            } else {
              vErrors.push(err27);
            }
            errors++;
          }
        }
        let i2 = data8.length;
        let j0;
        if (i2 > 1) {
          outer0: for (; i2--; ) {
            for (j0 = i2; j0--; ) {
              if (func0(data8[i2], data8[j0])) {
                const err28 = { instancePath: instancePath + "/entry_modules", schemaPath: "#/properties/entry_modules/uniqueItems", keyword: "uniqueItems", params: { i: i2, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i2 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err28];
                } else {
                  vErrors.push(err28);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err29 = { instancePath: instancePath + "/entry_modules", schemaPath: "#/properties/entry_modules/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.canonical_source_inventory !== void 0) {
      let data10 = data.canonical_source_inventory;
      if (Array.isArray(data10)) {
        if (data10.length < 1) {
          const err30 = { instancePath: instancePath + "/canonical_source_inventory", schemaPath: "#/properties/canonical_source_inventory/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len2 = data10.length;
        for (let i3 = 0; i3 < len2; i3++) {
          if (!validate45(data10[i3], { instancePath: instancePath + "/canonical_source_inventory/" + i3, parentData: data10, parentDataProperty: i3, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err31 = { instancePath: instancePath + "/canonical_source_inventory", schemaPath: "#/properties/canonical_source_inventory/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.host_coverage !== void 0) {
      let data12 = data.host_coverage;
      if (Array.isArray(data12)) {
        const _errs29 = errors;
        const len3 = data12.length;
        for (let i4 = 0; i4 < len3; i4++) {
          let data13 = data12[i4];
          const _errs30 = errors;
          if (data13 && typeof data13 == "object" && !Array.isArray(data13)) {
            if (data13.host === void 0) {
              const err32 = { instancePath: instancePath + "/host_coverage/" + i4, schemaPath: "#/properties/host_coverage/allOf/0/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
            if (data13.host !== void 0) {
              if ("claude-code" !== data13.host) {
                const err33 = { instancePath: instancePath + "/host_coverage/" + i4 + "/host", schemaPath: "#/properties/host_coverage/allOf/0/contains/properties/host/const", keyword: "const", params: { allowedValue: "claude-code" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err33];
                } else {
                  vErrors.push(err33);
                }
                errors++;
              }
            }
          } else {
            const err34 = { instancePath: instancePath + "/host_coverage/" + i4, schemaPath: "#/properties/host_coverage/allOf/0/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err34];
            } else {
              vErrors.push(err34);
            }
            errors++;
          }
          var valid13 = _errs30 === errors;
          if (valid13) {
            break;
          }
        }
        if (!valid13) {
          const err35 = { instancePath: instancePath + "/host_coverage", schemaPath: "#/properties/host_coverage/allOf/0/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        } else {
          errors = _errs29;
          if (vErrors !== null) {
            if (_errs29) {
              vErrors.length = _errs29;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data12)) {
        const _errs34 = errors;
        const len4 = data12.length;
        for (let i5 = 0; i5 < len4; i5++) {
          let data15 = data12[i5];
          const _errs35 = errors;
          if (data15 && typeof data15 == "object" && !Array.isArray(data15)) {
            if (data15.host === void 0) {
              const err36 = { instancePath: instancePath + "/host_coverage/" + i5, schemaPath: "#/properties/host_coverage/allOf/1/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
            if (data15.host !== void 0) {
              if ("codex" !== data15.host) {
                const err37 = { instancePath: instancePath + "/host_coverage/" + i5 + "/host", schemaPath: "#/properties/host_coverage/allOf/1/contains/properties/host/const", keyword: "const", params: { allowedValue: "codex" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err37];
                } else {
                  vErrors.push(err37);
                }
                errors++;
              }
            }
          } else {
            const err38 = { instancePath: instancePath + "/host_coverage/" + i5, schemaPath: "#/properties/host_coverage/allOf/1/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err38];
            } else {
              vErrors.push(err38);
            }
            errors++;
          }
          var valid15 = _errs35 === errors;
          if (valid15) {
            break;
          }
        }
        if (!valid15) {
          const err39 = { instancePath: instancePath + "/host_coverage", schemaPath: "#/properties/host_coverage/allOf/1/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err39];
          } else {
            vErrors.push(err39);
          }
          errors++;
        } else {
          errors = _errs34;
          if (vErrors !== null) {
            if (_errs34) {
              vErrors.length = _errs34;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data12)) {
        const _errs39 = errors;
        const len5 = data12.length;
        for (let i6 = 0; i6 < len5; i6++) {
          let data17 = data12[i6];
          const _errs40 = errors;
          if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
            if (data17.host === void 0) {
              const err40 = { instancePath: instancePath + "/host_coverage/" + i6, schemaPath: "#/properties/host_coverage/allOf/2/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err40];
              } else {
                vErrors.push(err40);
              }
              errors++;
            }
            if (data17.host !== void 0) {
              if ("cursor" !== data17.host) {
                const err41 = { instancePath: instancePath + "/host_coverage/" + i6 + "/host", schemaPath: "#/properties/host_coverage/allOf/2/contains/properties/host/const", keyword: "const", params: { allowedValue: "cursor" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err41];
                } else {
                  vErrors.push(err41);
                }
                errors++;
              }
            }
          } else {
            const err42 = { instancePath: instancePath + "/host_coverage/" + i6, schemaPath: "#/properties/host_coverage/allOf/2/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
          var valid17 = _errs40 === errors;
          if (valid17) {
            break;
          }
        }
        if (!valid17) {
          const err43 = { instancePath: instancePath + "/host_coverage", schemaPath: "#/properties/host_coverage/allOf/2/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        } else {
          errors = _errs39;
          if (vErrors !== null) {
            if (_errs39) {
              vErrors.length = _errs39;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data12)) {
        const _errs44 = errors;
        const len6 = data12.length;
        for (let i7 = 0; i7 < len6; i7++) {
          let data19 = data12[i7];
          const _errs45 = errors;
          if (data19 && typeof data19 == "object" && !Array.isArray(data19)) {
            if (data19.host === void 0) {
              const err44 = { instancePath: instancePath + "/host_coverage/" + i7, schemaPath: "#/properties/host_coverage/allOf/3/contains/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
            if (data19.host !== void 0) {
              if ("kimi-code" !== data19.host) {
                const err45 = { instancePath: instancePath + "/host_coverage/" + i7 + "/host", schemaPath: "#/properties/host_coverage/allOf/3/contains/properties/host/const", keyword: "const", params: { allowedValue: "kimi-code" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err45];
                } else {
                  vErrors.push(err45);
                }
                errors++;
              }
            }
          } else {
            const err46 = { instancePath: instancePath + "/host_coverage/" + i7, schemaPath: "#/properties/host_coverage/allOf/3/contains/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err46];
            } else {
              vErrors.push(err46);
            }
            errors++;
          }
          var valid19 = _errs45 === errors;
          if (valid19) {
            break;
          }
        }
        if (!valid19) {
          const err47 = { instancePath: instancePath + "/host_coverage", schemaPath: "#/properties/host_coverage/allOf/3/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
          if (vErrors === null) {
            vErrors = [err47];
          } else {
            vErrors.push(err47);
          }
          errors++;
        } else {
          errors = _errs44;
          if (vErrors !== null) {
            if (_errs44) {
              vErrors.length = _errs44;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (Array.isArray(data12)) {
        if (data12.length > 4) {
          const err48 = { instancePath: instancePath + "/host_coverage", schemaPath: "#/properties/host_coverage/maxItems", keyword: "maxItems", params: { limit: 4 }, message: "must NOT have more than 4 items" };
          if (vErrors === null) {
            vErrors = [err48];
          } else {
            vErrors.push(err48);
          }
          errors++;
        }
        if (data12.length < 4) {
          const err49 = { instancePath: instancePath + "/host_coverage", schemaPath: "#/properties/host_coverage/minItems", keyword: "minItems", params: { limit: 4 }, message: "must NOT have fewer than 4 items" };
          if (vErrors === null) {
            vErrors = [err49];
          } else {
            vErrors.push(err49);
          }
          errors++;
        }
        const len7 = data12.length;
        for (let i8 = 0; i8 < len7; i8++) {
          if (!validate49(data12[i8], { instancePath: instancePath + "/host_coverage/" + i8, parentData: data12, parentDataProperty: i8, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate49.errors : vErrors.concat(validate49.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err50 = { instancePath: instancePath + "/host_coverage", schemaPath: "#/properties/host_coverage/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err50];
        } else {
          vErrors.push(err50);
        }
        errors++;
      }
    }
    if (data.lifecycle !== void 0) {
      if (!validate30(data.lifecycle, { instancePath: instancePath + "/lifecycle", parentData: data, parentDataProperty: "lifecycle", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
        errors = vErrors.length;
      }
    }
    if (data.admission !== void 0) {
      if (!validate34(data.admission, { instancePath: instancePath + "/admission", parentData: data, parentDataProperty: "admission", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err51 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err51];
    } else {
      vErrors.push(err51);
    }
    errors++;
  }
  validate42.errors = vErrors;
  return errors === 0;
}
validate42.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema85 = { "type": "object", "additionalProperties": false, "required": ["schema_version", "kind", "id", "owner_skill", "title", "intent", "recognition_cues", "boundary", "access", "lifecycle", "admission", "points", "edges"], "properties": { "schema_version": { "$ref": "#/$defs/schemaVersion" }, "kind": { "const": "module" }, "id": { "$ref": "#/$defs/moduleId" }, "owner_skill": { "$ref": "#/$defs/skillId" }, "title": { "$ref": "#/$defs/nonEmptyString" }, "intent": { "$ref": "#/$defs/nonEmptyString" }, "recognition_cues": { "$ref": "#/$defs/uniqueStringList", "minItems": 1 }, "boundary": { "$ref": "#/$defs/moduleBoundary" }, "access": { "$ref": "#/$defs/access" }, "lifecycle": { "$ref": "#/$defs/lifecycle" }, "admission": { "$ref": "#/$defs/admission" }, "points": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/point" } }, "edges": { "type": "array", "items": { "$ref": "#/$defs/navigationEdge" } } } };
function validate56(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate56.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.includes === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "includes" }, message: "must have required property 'includes'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.excludes === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "excludes" }, message: "must have required property 'excludes'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "includes" || key0 === "excludes")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.includes !== void 0) {
      let data0 = data.includes;
      if (!validate25(data0, { instancePath: instancePath + "/includes", parentData: data, parentDataProperty: "includes", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
      if (Array.isArray(data0)) {
        if (data0.length < 1) {
          const err3 = { instancePath: instancePath + "/includes", schemaPath: "#/properties/includes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      }
    }
    if (data.excludes !== void 0) {
      let data1 = data.excludes;
      if (!validate25(data1, { instancePath: instancePath + "/excludes", parentData: data, parentDataProperty: "excludes", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
      if (Array.isArray(data1)) {
        if (data1.length < 1) {
          const err4 = { instancePath: instancePath + "/excludes", schemaPath: "#/properties/excludes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
    }
  } else {
    const err5 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  }
  validate56.errors = vErrors;
  return errors === 0;
}
validate56.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema92 = { "type": "object", "additionalProperties": false, "required": ["class", "relevant_entries", "primary_points", "rationale"], "properties": { "class": { "enum": ["critical", "primary", "on_demand"] }, "relevant_entries": { "type": "array", "items": { "$ref": "#/$defs/entryId" }, "uniqueItems": true }, "primary_points": { "type": "array", "items": { "$ref": "#/$defs/pointId" }, "uniqueItems": true }, "rationale": { "$ref": "#/$defs/nonEmptyString" } }, "allOf": [{ "if": { "properties": { "class": { "enum": ["critical", "primary"] } }, "required": ["class"] }, "then": { "properties": { "relevant_entries": { "minItems": 1 }, "primary_points": { "minItems": 1 } } } }] };
function validate60(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate60.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing0;
    if (data.class === void 0 && (missing0 = "class")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.class !== void 0) {
        let data0 = data.class;
        if (!(data0 === "critical" || data0 === "primary")) {
          const err1 = {};
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.relevant_entries !== void 0) {
        let data1 = data.relevant_entries;
        if (Array.isArray(data1)) {
          if (data1.length < 1) {
            const err2 = { instancePath: instancePath + "/relevant_entries", schemaPath: "#/allOf/0/then/properties/relevant_entries/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
      }
      if (data.primary_points !== void 0) {
        let data2 = data.primary_points;
        if (Array.isArray(data2)) {
          if (data2.length < 1) {
            const err3 = { instancePath: instancePath + "/primary_points", schemaPath: "#/allOf/0/then/properties/primary_points/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.relevant_entries = true;
      props0.primary_points = true;
      props0.class = true;
    }
  }
  if (!valid1) {
    const err4 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.class === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "class" }, message: "must have required property 'class'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.relevant_entries === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "relevant_entries" }, message: "must have required property 'relevant_entries'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.primary_points === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "primary_points" }, message: "must have required property 'primary_points'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "class" || key0 === "relevant_entries" || key0 === "primary_points" || key0 === "rationale")) {
        const err9 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.class !== void 0) {
      let data3 = data.class;
      if (!(data3 === "critical" || data3 === "primary" || data3 === "on_demand")) {
        const err10 = { instancePath: instancePath + "/class", schemaPath: "#/properties/class/enum", keyword: "enum", params: { allowedValues: schema92.properties.class.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.relevant_entries !== void 0) {
      let data4 = data.relevant_entries;
      if (Array.isArray(data4)) {
        const len0 = data4.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data5 = data4[i0];
          if (typeof data5 === "string") {
            if (!pattern7.test(data5)) {
              const err11 = { instancePath: instancePath + "/relevant_entries/" + i0, schemaPath: "#/$defs/entryId/pattern", keyword: "pattern", params: { pattern: "^entry:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^entry:[a-z0-9][a-z0-9.-]*$"' };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          } else {
            const err12 = { instancePath: instancePath + "/relevant_entries/" + i0, schemaPath: "#/$defs/entryId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        let i1 = data4.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data4[i1], data4[j0])) {
                const err13 = { instancePath: instancePath + "/relevant_entries", schemaPath: "#/properties/relevant_entries/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err13];
                } else {
                  vErrors.push(err13);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err14 = { instancePath: instancePath + "/relevant_entries", schemaPath: "#/properties/relevant_entries/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.primary_points !== void 0) {
      let data6 = data.primary_points;
      if (Array.isArray(data6)) {
        const len1 = data6.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data7 = data6[i2];
          if (typeof data7 === "string") {
            if (!pattern12.test(data7)) {
              const err15 = { instancePath: instancePath + "/primary_points/" + i2, schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
          } else {
            const err16 = { instancePath: instancePath + "/primary_points/" + i2, schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
        let i3 = data6.length;
        let j1;
        if (i3 > 1) {
          outer1: for (; i3--; ) {
            for (j1 = i3; j1--; ) {
              if (func0(data6[i3], data6[j1])) {
                const err17 = { instancePath: instancePath + "/primary_points", schemaPath: "#/properties/primary_points/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i3 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
                break outer1;
              }
            }
          }
        }
      } else {
        const err18 = { instancePath: instancePath + "/primary_points", schemaPath: "#/properties/primary_points/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data8 = data.rationale;
      if (typeof data8 === "string") {
        if (func3(data8) < 1) {
          const err19 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      } else {
        const err20 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
  } else {
    const err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err21];
    } else {
      vErrors.push(err21);
    }
    errors++;
  }
  validate60.errors = vErrors;
  return errors === 0;
}
validate60.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema96 = { "type": "object", "additionalProperties": false, "required": ["id", "title", "point_kind", "summary", "recognition_cues", "binding", "authority", "lifecycle", "admission"], "properties": { "id": { "$ref": "#/$defs/pointId" }, "title": { "$ref": "#/$defs/nonEmptyString" }, "point_kind": { "enum": ["principle", "decision_rule", "procedure", "check", "boundary", "example", "reference"] }, "summary": { "$ref": "#/$defs/nonEmptyString" }, "recognition_cues": { "$ref": "#/$defs/uniqueStringList", "minItems": 1 }, "binding": { "$ref": "#/$defs/binding" }, "authority": { "$ref": "#/$defs/authority" }, "lifecycle": { "$ref": "#/$defs/lifecycle" }, "admission": { "$ref": "#/$defs/admission" } } };
function validate66(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate66.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.path === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.marker === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "marker" }, message: "must have required property 'marker'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "path" || key0 === "marker" || key0 === "heading_hint")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.path !== void 0) {
      let data0 = data.path;
      if (typeof data0 === "string") {
        if (!pattern8.test(data0)) {
          const err3 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoMarkdownPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._/-]+\\.md$" }, message: 'must match pattern "^[A-Za-z0-9._/-]+\\.md$"' };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoMarkdownPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.marker !== void 0) {
      let data1 = data.marker;
      if (typeof data1 === "string") {
        if (!pattern12.test(data1)) {
          const err5 = { instancePath: instancePath + "/marker", schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/marker", schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.heading_hint !== void 0) {
      let data2 = data.heading_hint;
      if (typeof data2 === "string") {
        if (func3(data2) < 1) {
          const err7 = { instancePath: instancePath + "/heading_hint", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/heading_hint", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
  } else {
    const err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err9];
    } else {
      vErrors.push(err9);
    }
    errors++;
  }
  validate66.errors = vErrors;
  return errors === 0;
}
validate66.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var pattern31 = new RegExp("^subject:[a-z0-9][a-z0-9.-]*$", "u");
function validate69(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate69.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.role === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "role" }, message: "must have required property 'role'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subject === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "role" || key0 === "subject")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.role !== void 0) {
      if ("canonical" !== data.role) {
        const err3 = { instancePath: instancePath + "/role", schemaPath: "#/properties/role/const", keyword: "const", params: { allowedValue: "canonical" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.subject !== void 0) {
      let data1 = data.subject;
      if (typeof data1 === "string") {
        if (!pattern31.test(data1)) {
          const err4 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/subjectId/pattern", keyword: "pattern", params: { pattern: "^subject:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^subject:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/subjectId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
  } else {
    const err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err6];
    } else {
      vErrors.push(err6);
    }
    errors++;
  }
  validate69.errors = vErrors;
  return errors === 0;
}
validate69.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema107 = { "type": "object", "additionalProperties": false, "required": ["role", "subject", "canonical", "review_policy", "reviewed_canonical_sha256"], "properties": { "role": { "enum": ["summary", "example"] }, "subject": { "$ref": "#/$defs/subjectId" }, "canonical": { "$ref": "#/$defs/pointId" }, "review_policy": { "enum": ["review-on-canonical-change", "generated"] }, "reviewed_canonical_sha256": { "$ref": "#/$defs/sha256" } } };
function validate71(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate71.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.role === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "role" }, message: "must have required property 'role'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subject === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.canonical === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "canonical" }, message: "must have required property 'canonical'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.review_policy === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "review_policy" }, message: "must have required property 'review_policy'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.reviewed_canonical_sha256 === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reviewed_canonical_sha256" }, message: "must have required property 'reviewed_canonical_sha256'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "role" || key0 === "subject" || key0 === "canonical" || key0 === "review_policy" || key0 === "reviewed_canonical_sha256")) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.role !== void 0) {
      let data0 = data.role;
      if (!(data0 === "summary" || data0 === "example")) {
        const err6 = { instancePath: instancePath + "/role", schemaPath: "#/properties/role/enum", keyword: "enum", params: { allowedValues: schema107.properties.role.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.subject !== void 0) {
      let data1 = data.subject;
      if (typeof data1 === "string") {
        if (!pattern31.test(data1)) {
          const err7 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/subjectId/pattern", keyword: "pattern", params: { pattern: "^subject:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^subject:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/subjectId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.canonical !== void 0) {
      let data2 = data.canonical;
      if (typeof data2 === "string") {
        if (!pattern12.test(data2)) {
          const err9 = { instancePath: instancePath + "/canonical", schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/canonical", schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.review_policy !== void 0) {
      let data3 = data.review_policy;
      if (!(data3 === "review-on-canonical-change" || data3 === "generated")) {
        const err11 = { instancePath: instancePath + "/review_policy", schemaPath: "#/properties/review_policy/enum", keyword: "enum", params: { allowedValues: schema107.properties.review_policy.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.reviewed_canonical_sha256 !== void 0) {
      let data4 = data.reviewed_canonical_sha256;
      if (typeof data4 === "string") {
        if (!pattern22.test(data4)) {
          const err12 = { instancePath: instancePath + "/reviewed_canonical_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/reviewed_canonical_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  validate71.errors = vErrors;
  return errors === 0;
}
validate71.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate68(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate68.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (!validate69(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (!validate71(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate71.errors : vErrors.concat(validate71.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
  }
  if (!valid0) {
    const err0 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate68.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate68.evaluated = { "dynamicProps": true, "dynamicItems": false };
function validate64(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate64.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.title === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.point_kind === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "point_kind" }, message: "must have required property 'point_kind'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.summary === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "summary" }, message: "must have required property 'summary'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.recognition_cues === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "recognition_cues" }, message: "must have required property 'recognition_cues'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.authority === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "authority" }, message: "must have required property 'authority'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.lifecycle === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "lifecycle" }, message: "must have required property 'lifecycle'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.admission === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "admission" }, message: "must have required property 'admission'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema96.properties, key0)) {
        const err9 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern12.test(data0)) {
          const err10 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.title !== void 0) {
      let data1 = data.title;
      if (typeof data1 === "string") {
        if (func3(data1) < 1) {
          const err12 = { instancePath: instancePath + "/title", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/title", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.point_kind !== void 0) {
      let data2 = data.point_kind;
      if (!(data2 === "principle" || data2 === "decision_rule" || data2 === "procedure" || data2 === "check" || data2 === "boundary" || data2 === "example" || data2 === "reference")) {
        const err14 = { instancePath: instancePath + "/point_kind", schemaPath: "#/properties/point_kind/enum", keyword: "enum", params: { allowedValues: schema96.properties.point_kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.summary !== void 0) {
      let data3 = data.summary;
      if (typeof data3 === "string") {
        if (func3(data3) < 1) {
          const err15 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.recognition_cues !== void 0) {
      let data4 = data.recognition_cues;
      if (!validate25(data4, { instancePath: instancePath + "/recognition_cues", parentData: data, parentDataProperty: "recognition_cues", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
      if (Array.isArray(data4)) {
        if (data4.length < 1) {
          const err17 = { instancePath: instancePath + "/recognition_cues", schemaPath: "#/properties/recognition_cues/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      }
    }
    if (data.binding !== void 0) {
      if (!validate66(data.binding, { instancePath: instancePath + "/binding", parentData: data, parentDataProperty: "binding", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
        errors = vErrors.length;
      }
    }
    if (data.authority !== void 0) {
      if (!validate68(data.authority, { instancePath: instancePath + "/authority", parentData: data, parentDataProperty: "authority", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
        errors = vErrors.length;
      }
    }
    if (data.lifecycle !== void 0) {
      if (!validate30(data.lifecycle, { instancePath: instancePath + "/lifecycle", parentData: data, parentDataProperty: "lifecycle", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
        errors = vErrors.length;
      }
    }
    if (data.admission !== void 0) {
      if (!validate34(data.admission, { instancePath: instancePath + "/admission", parentData: data, parentDataProperty: "admission", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  validate64.errors = vErrors;
  return errors === 0;
}
validate64.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema111 = { "type": "object", "additionalProperties": false, "required": ["id", "type", "from", "to", "when", "path_role", "runtime", "lifecycle", "admission"], "properties": { "id": { "$ref": "#/$defs/edgeId" }, "type": { "enum": ["requires", "next", "deepens_to", "operationalizes", "applies_to", "contrasts_with", "fallback_to", "routes_to"] }, "from": { "$ref": "#/$defs/globalId" }, "to": { "$ref": "#/$defs/globalId" }, "when": { "$ref": "#/$defs/uniqueStringList", "minItems": 1 }, "avoid_when": { "$ref": "#/$defs/uniqueStringList" }, "path_role": { "enum": ["support", "next", "check", "contrast", "fallback", "route"] }, "order": { "type": "integer", "minimum": 0 }, "runtime": { "$ref": "#/$defs/edgeRuntime" }, "lifecycle": { "$ref": "#/$defs/lifecycle" }, "admission": { "$ref": "#/$defs/admission" } } };
var pattern35 = new RegExp("^edge:[a-z0-9][a-z0-9.-]*$", "u");
var pattern38 = new RegExp("^[a-z0-9][a-z0-9-]*$", "u");
function validate80(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate80.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.enabled_by_default === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "enabled_by_default" }, message: "must have required property 'enabled_by_default'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "enabled_by_default" || key0 === "hosts")) {
        const err1 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.enabled_by_default !== void 0) {
      if (typeof data.enabled_by_default !== "boolean") {
        const err2 = { instancePath: instancePath + "/enabled_by_default", schemaPath: "#/properties/enabled_by_default/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.hosts !== void 0) {
      let data1 = data.hosts;
      if (Array.isArray(data1)) {
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (typeof data2 === "string") {
            if (!pattern38.test(data2)) {
              const err3 = { instancePath: instancePath + "/hosts/" + i0, schemaPath: "#/$defs/hostId/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]*$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]*$"' };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/hosts/" + i0, schemaPath: "#/$defs/hostId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        let i1 = data1.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data1[i1], data1[j0])) {
                const err5 = { instancePath: instancePath + "/hosts", schemaPath: "#/properties/hosts/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err5];
                } else {
                  vErrors.push(err5);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err6 = { instancePath: instancePath + "/hosts", schemaPath: "#/properties/hosts/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate80.errors = vErrors;
  return errors === 0;
}
validate80.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate77(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate77.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.from === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.to === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.when === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "when" }, message: "must have required property 'when'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.path_role === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path_role" }, message: "must have required property 'path_role'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.runtime === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtime" }, message: "must have required property 'runtime'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.lifecycle === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "lifecycle" }, message: "must have required property 'lifecycle'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.admission === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "admission" }, message: "must have required property 'admission'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema111.properties, key0)) {
        const err9 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern35.test(data0)) {
          const err10 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/edgeId/pattern", keyword: "pattern", params: { pattern: "^edge:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^edge:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/edgeId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      let data1 = data.type;
      if (!(data1 === "requires" || data1 === "next" || data1 === "deepens_to" || data1 === "operationalizes" || data1 === "applies_to" || data1 === "contrasts_with" || data1 === "fallback_to" || data1 === "routes_to")) {
        const err12 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: schema111.properties.type.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.from !== void 0) {
      let data2 = data.from;
      if (typeof data2 === "string") {
        if (!pattern13.test(data2)) {
          const err13 = { instancePath: instancePath + "/from", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/from", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.to !== void 0) {
      let data3 = data.to;
      if (typeof data3 === "string") {
        if (!pattern13.test(data3)) {
          const err15 = { instancePath: instancePath + "/to", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/to", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.when !== void 0) {
      let data4 = data.when;
      if (!validate25(data4, { instancePath: instancePath + "/when", parentData: data, parentDataProperty: "when", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
      if (Array.isArray(data4)) {
        if (data4.length < 1) {
          const err17 = { instancePath: instancePath + "/when", schemaPath: "#/properties/when/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      }
    }
    if (data.avoid_when !== void 0) {
      if (!validate25(data.avoid_when, { instancePath: instancePath + "/avoid_when", parentData: data, parentDataProperty: "avoid_when", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
    }
    if (data.path_role !== void 0) {
      let data6 = data.path_role;
      if (!(data6 === "support" || data6 === "next" || data6 === "check" || data6 === "contrast" || data6 === "fallback" || data6 === "route")) {
        const err18 = { instancePath: instancePath + "/path_role", schemaPath: "#/properties/path_role/enum", keyword: "enum", params: { allowedValues: schema111.properties.path_role.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.order !== void 0) {
      let data7 = data.order;
      if (!(typeof data7 == "number" && (!(data7 % 1) && !isNaN(data7)))) {
        const err19 = { instancePath: instancePath + "/order", schemaPath: "#/properties/order/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
      if (typeof data7 == "number") {
        if (data7 < 0 || isNaN(data7)) {
          const err20 = { instancePath: instancePath + "/order", schemaPath: "#/properties/order/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      }
    }
    if (data.runtime !== void 0) {
      if (!validate80(data.runtime, { instancePath: instancePath + "/runtime", parentData: data, parentDataProperty: "runtime", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
        errors = vErrors.length;
      }
    }
    if (data.lifecycle !== void 0) {
      if (!validate30(data.lifecycle, { instancePath: instancePath + "/lifecycle", parentData: data, parentDataProperty: "lifecycle", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
        errors = vErrors.length;
      }
    }
    if (data.admission !== void 0) {
      if (!validate34(data.admission, { instancePath: instancePath + "/admission", parentData: data, parentDataProperty: "admission", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err21];
    } else {
      vErrors.push(err21);
    }
    errors++;
  }
  validate77.errors = vErrors;
  return errors === 0;
}
validate77.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate54(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate54.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schema_version === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.owner_skill === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "owner_skill" }, message: "must have required property 'owner_skill'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.title === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.intent === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "intent" }, message: "must have required property 'intent'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.recognition_cues === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "recognition_cues" }, message: "must have required property 'recognition_cues'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.boundary === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "boundary" }, message: "must have required property 'boundary'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.access === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "access" }, message: "must have required property 'access'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.lifecycle === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "lifecycle" }, message: "must have required property 'lifecycle'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.admission === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "admission" }, message: "must have required property 'admission'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.points === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "points" }, message: "must have required property 'points'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    if (data.edges === void 0) {
      const err12 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edges" }, message: "must have required property 'edges'" };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema85.properties, key0)) {
        const err13 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0) {
      if ("cc-master/skill-knowledge-source/v1alpha1" !== data.schema_version) {
        const err14 = { instancePath: instancePath + "/schema_version", schemaPath: "#/$defs/schemaVersion/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-source/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      if ("module" !== data.kind) {
        const err15 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "module" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern11.test(data2)) {
          const err16 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/moduleId/pattern", keyword: "pattern", params: { pattern: "^module:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^module:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/moduleId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.owner_skill !== void 0) {
      let data3 = data.owner_skill;
      if (typeof data3 === "string") {
        if (!pattern5.test(data3)) {
          const err18 = { instancePath: instancePath + "/owner_skill", schemaPath: "#/$defs/skillId/pattern", keyword: "pattern", params: { pattern: "^skill:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^skill:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/owner_skill", schemaPath: "#/$defs/skillId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.title !== void 0) {
      let data4 = data.title;
      if (typeof data4 === "string") {
        if (func3(data4) < 1) {
          const err20 = { instancePath: instancePath + "/title", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/title", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.intent !== void 0) {
      let data5 = data.intent;
      if (typeof data5 === "string") {
        if (func3(data5) < 1) {
          const err22 = { instancePath: instancePath + "/intent", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
      } else {
        const err23 = { instancePath: instancePath + "/intent", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.recognition_cues !== void 0) {
      let data6 = data.recognition_cues;
      if (!validate25(data6, { instancePath: instancePath + "/recognition_cues", parentData: data, parentDataProperty: "recognition_cues", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
      if (Array.isArray(data6)) {
        if (data6.length < 1) {
          const err24 = { instancePath: instancePath + "/recognition_cues", schemaPath: "#/properties/recognition_cues/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
      }
    }
    if (data.boundary !== void 0) {
      if (!validate56(data.boundary, { instancePath: instancePath + "/boundary", parentData: data, parentDataProperty: "boundary", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
        errors = vErrors.length;
      }
    }
    if (data.access !== void 0) {
      if (!validate60(data.access, { instancePath: instancePath + "/access", parentData: data, parentDataProperty: "access", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
        errors = vErrors.length;
      }
    }
    if (data.lifecycle !== void 0) {
      if (!validate30(data.lifecycle, { instancePath: instancePath + "/lifecycle", parentData: data, parentDataProperty: "lifecycle", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
        errors = vErrors.length;
      }
    }
    if (data.admission !== void 0) {
      if (!validate34(data.admission, { instancePath: instancePath + "/admission", parentData: data, parentDataProperty: "admission", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
        errors = vErrors.length;
      }
    }
    if (data.points !== void 0) {
      let data11 = data.points;
      if (Array.isArray(data11)) {
        if (data11.length < 1) {
          const err25 = { instancePath: instancePath + "/points", schemaPath: "#/properties/points/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
        const len0 = data11.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate64(data11[i0], { instancePath: instancePath + "/points/" + i0, parentData: data11, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate64.errors : vErrors.concat(validate64.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err26 = { instancePath: instancePath + "/points", schemaPath: "#/properties/points/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.edges !== void 0) {
      let data13 = data.edges;
      if (Array.isArray(data13)) {
        const len1 = data13.length;
        for (let i1 = 0; i1 < len1; i1++) {
          if (!validate77(data13[i1], { instancePath: instancePath + "/edges/" + i1, parentData: data13, parentDataProperty: i1, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate77.errors : vErrors.concat(validate77.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
  } else {
    const err28 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err28];
    } else {
      vErrors.push(err28);
    }
    errors++;
  }
  validate54.errors = vErrors;
  return errors === 0;
}
validate54.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (!validate21(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (!validate42(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate42.errors : vErrors.concat(validate42.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
    const _errs3 = errors;
    if (!validate54(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
      vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
      errors = vErrors.length;
    }
    var _valid0 = _errs3 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props0 !== true) {
          props0 = true;
        }
      }
    }
  }
  if (!valid0) {
    const err0 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate20.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate20.evaluated = { "dynamicProps": true, "dynamicItems": false };
