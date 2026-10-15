import { z } from "zod";
import { ok, guard } from "./shared";
import type { AgentTool } from "../types";
import { checkScheduleHealth } from "@/lib/db/client";
import { describeModelConfiguration } from "../config";
import { nowSnapshot } from "@/lib/dates";

const getSystemStatusSchema = z.object({
  includeModels: z.boolean().optional().describe("Include AI model configuration diagnostics. Defaults to false."),
});

/**
 * Diagnostics for the internal schedule.
 *
 * This exists so the assistant can say *why* data is unavailable instead of
 * claiming a calendar is unreachable. A successfully read empty schedule and a
 * failed connection report different states.
 */
const getSystemStatusTool: AgentTool<typeof getSystemStatusSchema> = {
  name: "get_system_status",
  kind: "read",
  description:
    "Check whether the application's internal task database is reachable and whether the schedule was read successfully. Use this only when a previous tool failed, so you can explain the real limitation instead of guessing. Never use it in place of actually reading tasks.",
  schema: getSystemStatusSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const snapshot = nowSnapshot(ctx.timezone, ctx.now);
      const health = await checkScheduleHealth(ctx.today);

      const payload: Record<string, unknown> = {
        clock: {
          today: snapshot.iso,
          weekday: snapshot.weekday,
          time: snapshot.time12,
          timezone: snapshot.timezone,
          utc: snapshot.instant,
        },
        internalSchedule: {
          /** True only when the database answered a real query. */
          reachable: health.reachable,
          state: health.state,
          message: health.message,
          ...(health.taskCount !== undefined ? { taskCount: health.taskCount } : {}),
          ...(health.todayCount !== undefined ? { todayCount: health.todayCount } : {}),
          ...(health.code ? { errorCode: health.code } : {}),
        },
        externalCalendars: {
          connected: false,
          providers: [],
          note:
            "This application stores its schedule in its own database. No Google Calendar, Outlook or other external calendar account is connected.",
        },
      };

      if (args.includeModels) {
        // Reports identifiers and limits only — never key material.
        payload.models = describeModelConfiguration().map((config) => ({
          role: config.role,
          model: config.model,
          toolCalling: config.capabilities.toolCalling,
          parallelToolCalls: config.parallelToolCalls,
          maxCompletionTokens: config.maxCompletionTokens,
          verified: config.verified,
          ...(config.warnings.length > 0 ? { warnings: config.warnings } : {}),
        }));
      }

      return ok(payload);
    }),
};

export const SYSTEM_TOOLS = [getSystemStatusTool] as unknown as AgentTool[];
