import { expect, it } from "vitest";
import en from "./locales/en.json";
import ko from "./locales/ko.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";

it("describes MCP approval grants as connection-scoped in every locale", () => {
  expect(en.ai.externalMcpAllowSession).toBe("Allow for this connection");
  expect(zhCN.ai.externalMcpAllowSession).toBe("本次连接中允许");
  expect(zhTW.ai.externalMcpAllowSession).toBe("此連線期間允許");
  expect(ko.ai.externalMcpAllowSession).toBe("이 연결에서 허용");
});
