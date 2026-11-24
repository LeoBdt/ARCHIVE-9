import { describe, expect, it } from "vitest";
import { commitTouches, nextSiteVersion } from "./release.ts";

describe("commitTouches", () => {
  it("sorts files between the bot and the site", () => {
    expect([...commitTouches(["apps/web/src/client/pages/Home.tsx"])]).toEqual(["site"]);
    expect([...commitTouches(["packages/ai/src/reply.ts", "apps/web/src/server/app.ts"])].sort()).toEqual(["core", "site"]);
    expect([...commitTouches(["packages/db/src/repositories/site-pages.ts"])]).toEqual(["site"]);
    expect([...commitTouches(["packages/db/src/repositories/learning.ts"])]).toEqual(["core"]);
    expect([...commitTouches(["README.md", ".github/workflows/ci.yml"])]).toEqual([]);
  });
});

describe("nextSiteVersion", () => {
  it("bumps the minor for a feature, the patch otherwise", () => {
    expect(nextSiteVersion(null, ["feat(web): x"])).toBe("1.0.0");
    expect(nextSiteVersion("1.2.3", ["fix(web): y", "feat(web): x"])).toBe("1.3.0");
    expect(nextSiteVersion("1.2.3", ["fix: y"])).toBe("1.2.4");
  });
});
