import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFlowSchema, saveFlowSteps, updateFlowSchema } from "@/lib/flows/save";

vi.mock("@/lib/tracking/server", () => ({ generateTrackedLinkSlug: () => "newslug" }));

function makeTx() {
  let created = 0;
  return {
    flowStep: {
      findMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
      create: vi.fn().mockImplementation(async () => ({ id: `new${++created}` })),
    },
    flowButton: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("flow schemas", () => {
  it("requires keywords when the trigger is not any-message", () => {
    const base = { instagramAccountId: "acct", name: "Boas-vindas", steps: [{ delayMinutes: 0, message: "oi" }] };
    expect(createFlowSchema.safeParse({ ...base, triggerAnyMessage: false }).success).toBe(false);
    expect(createFlowSchema.safeParse({ ...base, triggerAnyMessage: false, triggerKeywords: ["ebook"] }).success).toBe(true);
    expect(createFlowSchema.safeParse(base).success).toBe(true);
  });

  it("caps buttons at three and titles at 20 chars", () => {
    const step = (buttons: unknown[]) => ({ delayMinutes: 0, message: "oi", buttons });
    const btn = { title: "Ver", url: "https://x.test" };
    expect(updateFlowSchema.safeParse({ steps: [step([btn, btn, btn])] }).success).toBe(true);
    expect(updateFlowSchema.safeParse({ steps: [step([btn, btn, btn, btn])] }).success).toBe(false);
    expect(updateFlowSchema.safeParse({ steps: [step([{ ...btn, title: "x".repeat(21) }])] }).success).toBe(false);
    expect(updateFlowSchema.safeParse({ steps: [step([{ ...btn, url: "not a url" }])] }).success).toBe(false);
  });
});

describe("saveFlowSteps", () => {
  let tx: ReturnType<typeof makeTx>;
  beforeEach(() => {
    tx = makeTx();
  });

  it("creates steps and buttons with fresh slugs on a new flow", async () => {
    tx.flowStep.findMany.mockResolvedValue([]);
    await saveFlowSteps(tx as never, "flow1", [
      { delayMinutes: 0, message: "oi", buttons: [{ title: "Ver", url: "https://x.test" }] },
      { delayMinutes: 10, message: "e aí", buttons: [] },
    ]);
    expect(tx.flowStep.create).toHaveBeenCalledTimes(2);
    expect(tx.flowStep.create.mock.calls[0][0]).toMatchObject({ data: { flowId: "flow1", position: 0, delayMinutes: 0 } });
    expect(tx.flowStep.create.mock.calls[1][0]).toMatchObject({ data: { position: 1, delayMinutes: 10 } });
    expect(tx.flowButton.create).toHaveBeenCalledWith({
      data: { stepId: "new1", position: 0, title: "Ver", url: "https://x.test", slug: "newslug" },
    });
    expect(tx.flowStep.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps ids (and therefore slugs and history) when steps are reordered or edited", async () => {
    tx.flowStep.findMany.mockResolvedValue([
      { id: "a", buttons: [{ id: "btnA" }] },
      { id: "b", buttons: [] },
      { id: "c", buttons: [] },
    ]);
    await saveFlowSteps(tx as never, "flow1", [
      { id: "b", delayMinutes: 5, message: "b primeiro", buttons: [] },
      { id: "a", delayMinutes: 0, message: "a depois", buttons: [{ id: "btnA", title: "Novo título", url: "https://y.test" }] },
      { delayMinutes: 60, message: "novo", buttons: [] },
    ]);
    // c was dropped.
    expect(tx.flowStep.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["c"] } } });
    // Kept steps are parked at negative positions before the final numbering.
    const positions = tx.flowStep.update.mock.calls.map((c) => c[0].data.position);
    expect(positions.slice(0, 2).every((p: number) => p < 0)).toBe(true);
    expect(tx.flowStep.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b" }, data: expect.objectContaining({ position: 0, message: "b primeiro" }) })
    );
    expect(tx.flowStep.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a" }, data: expect.objectContaining({ position: 1, message: "a depois" }) })
    );
    expect(tx.flowStep.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ position: 2 }) }));
    // The existing button is updated in place: same id, same slug.
    expect(tx.flowButton.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "btnA" }, data: expect.objectContaining({ title: "Novo título", url: "https://y.test" }) })
    );
    expect(tx.flowButton.create).not.toHaveBeenCalled();
  });

  it("ignores unknown ids instead of trusting them", async () => {
    tx.flowStep.findMany.mockResolvedValue([{ id: "a", buttons: [] }]);
    await saveFlowSteps(tx as never, "flow1", [{ id: "from-another-flow", delayMinutes: 0, message: "x", buttons: [] }]);
    expect(tx.flowStep.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } } });
    expect(tx.flowStep.create).toHaveBeenCalledTimes(1);
  });
});
