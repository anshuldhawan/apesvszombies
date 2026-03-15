import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGeneratedWorldDefinition,
  buildShooterWorldPrompt,
  generateWorldFromLocation,
  resolveGeneratedWorldAssets,
  selectPreferredSpzUrl
} from "./worldlabs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildShooterWorldPrompt", () => {
  it("builds the fixed shooter-world prompt from trimmed input", () => {
    expect(buildShooterWorldPrompt("  desert canyon outpost  ")).toBe(
      "Generate a desert canyon outpost world that functions as a map and scene for playing a shooter game. i.e it has a way for players to hide behind structures"
    );
  });

  it("rejects empty locations", () => {
    expect(() => buildShooterWorldPrompt("   ")).toThrow(
      "Enter a location before generating a world."
    );
  });
});

describe("resolveGeneratedWorldAssets", () => {
  it("accepts either world_id or id from World Labs payloads", () => {
    const assets = resolveGeneratedWorldAssets({
      id: "world-321",
      display_name: "Flooded Metro",
      assets: {
        mesh: {
          collider_mesh_url: "https://example.com/collider.glb"
        },
        splats: {
          spz_urls: {
            "500k": "https://example.com/500k.spz"
          }
        }
      }
    });

    expect(assets.worldId).toBe("world-321");
  });

  it("prefers the 100k splat when multiple SPZ sizes are available", () => {
    const assets = resolveGeneratedWorldAssets({
      world_id: "world-123",
      display_name: "Storm Keep",
      assets: {
        mesh: {
          collider_mesh_url: "https://example.com/collider.glb"
        },
        splats: {
          spz_urls: {
            "100k": "https://example.com/100k.spz",
            full_res: "https://example.com/full.spz",
            "500k": "https://example.com/500k.spz"
          }
        }
      }
    });

    expect(assets.spzUrl).toBe("https://example.com/100k.spz");
    expect(assets.collisionGlbUrl).toBe("https://example.com/collider.glb");
  });

  it("falls back from 100k to 500k to full_res", () => {
    expect(
      selectPreferredSpzUrl({
        "500k": "https://example.com/500k.spz",
        full_res: "https://example.com/full.spz"
      })
    ).toBe("https://example.com/500k.spz");

    expect(
      selectPreferredSpzUrl({
        full_res: "https://example.com/full.spz"
      })
    ).toBe("https://example.com/full.spz");
  });

  it("throws when a collider mesh is missing", () => {
    expect(() =>
      resolveGeneratedWorldAssets({
        world_id: "world-123",
        assets: {
          splats: {
            spz_urls: {
              "500k": "https://example.com/500k.spz"
            }
          }
        }
      })
    ).toThrow("World Labs did not return a collider mesh for this world.");
  });

  it("throws when no SPZ URL is available", () => {
    expect(() =>
      buildGeneratedWorldDefinition("orbital station", {
        world_id: "world-123",
        assets: {
          mesh: {
            collider_mesh_url: "https://example.com/collider.glb"
          },
          splats: {
            spz_urls: {}
          }
        }
      })
    ).toThrow("World Labs did not return a usable SPZ splat URL for this world.");
  });
});

describe("generateWorldFromLocation", () => {
  it("starts as soon as the world endpoint has both splat and collider assets", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const progress = vi.fn();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          done: false,
          operation_id: "operation-1"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          done: false,
          operation_id: "operation-1",
          metadata: {
            world_id: "world-123",
            progress: {
              description: "World generation in progress."
            }
          },
          response: null
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world_id: "world-123",
          display_name: "Snow Fortress",
          world_marble_url: "https://example.com/world",
          assets: {
            mesh: {
              collider_mesh_url: "https://example.com/collider.glb"
            },
            splats: {
              spz_urls: {
                "500k": "https://example.com/world.spz"
              }
            }
          }
        })
      );

    const result = await generateWorldFromLocation("snow fortress", {
      apiKey: "test-key",
      fetchFn,
      onProgress: progress,
      sleep: async () => {},
      now: () => 0
    });

    expect(result).toEqual({
      kind: "success",
      world: {
        id: "world-123",
        label: "Snow Fortress",
        spzUrl: "https://example.com/world.spz",
        collisionGlbUrl: "https://example.com/collider.glb",
        source: "generated",
        worldLabsId: "world-123",
        promptText:
          "Generate a snow fortress world that functions as a map and scene for playing a shooter game. i.e it has a way for players to hide behind structures",
        worldMarbleUrl: "https://example.com/world",
        thumbnailUrl: undefined
      },
      attemptCount: 1,
      readinessSource: "world"
    });

    expect(progress).toHaveBeenNthCalledWith(1, {
      phase: "requesting",
      message: "Sending your prompt to World Labs.",
      operationId: null,
      worldId: null,
      attempt: 1,
      elapsedMs: 0,
      source: "operation"
    });
    expect(progress).toHaveBeenNthCalledWith(2, {
      phase: "polling",
      message: "Generating a shooter-ready snow fortress world.",
      operationId: "operation-1",
      worldId: null,
      attempt: 1,
      elapsedMs: 0,
      source: "operation"
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[2]?.[0]).toBe("https://api.worldlabs.ai/marble/v1/worlds/world-123");
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        display_name: "Snow Fortress",
        model: "Marble 0.1-plus",
        world_prompt: {
          type: "text",
          text_prompt:
            "Generate a snow fortress world that functions as a map and scene for playing a shooter game. i.e it has a way for players to hide behind structures",
          disable_recaption: true
        }
      })
    );
    expect(consoleInfo).toHaveBeenCalled();
  });

  it("surfaces validation errors as request failures", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          detail: [
            {
              loc: ["body", "world_prompt", "type"],
              msg: "Input should be 'text' or 'world_id'."
            }
          ]
        },
        422
      )
    );

    const result = await generateWorldFromLocation("misty harbor", {
      apiKey: "test-key",
      fetchFn
    });

    expect(result).toEqual({
      kind: "failed",
      code: "request_error",
      reason: "body.world_prompt.type: Input should be 'text' or 'world_id'.",
      worldId: null,
      operationId: null,
      worldMarbleUrl: undefined,
      assetSummary: "world payload unavailable",
      attemptCount: 1
    });
  });

  it("returns an operation failure immediately without retrying", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          done: false,
          operation_id: "operation-1"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          done: true,
          operation_id: "operation-1",
          error: {
            message: "Insufficient credits."
          }
        })
      );

    const result = await generateWorldFromLocation("orbital railyard", {
      apiKey: "test-key",
      fetchFn,
      sleep: async () => {},
      now: () => 0
    });

    expect(result).toEqual({
      kind: "failed",
      code: "operation_error",
      reason: "Insufficient credits.",
      worldId: null,
      operationId: "operation-1",
      worldMarbleUrl: undefined,
      assetSummary: "world payload unavailable",
      attemptCount: 1
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(consoleInfo).toHaveBeenCalled();
  });

  it("retries once when the first generated world never gets a collider mesh", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const progress = vi.fn();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          done: false,
          operation_id: "operation-1",
          metadata: {
            world_id: "world-111"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world_id: "world-111",
          display_name: "Retry One",
          world_marble_url: "https://example.com/world-111",
          assets: {
            mesh: {
              collider_mesh_url: null
            },
            splats: {
              spz_urls: {
                "500k": "https://example.com/world-111.spz"
              }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          done: false,
          operation_id: "operation-2",
          metadata: {
            world_id: "world-222"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world_id: "world-222",
          display_name: "Retry Two",
          world_marble_url: "https://example.com/world-222",
          assets: {
            mesh: {
              collider_mesh_url: "https://example.com/world-222.glb"
            },
            splats: {
              spz_urls: {
                full_res: "https://example.com/world-222.spz"
              }
            }
          }
        })
      );

    const result = await generateWorldFromLocation("retry canyon", {
      apiKey: "test-key",
      fetchFn,
      timeoutMs: 0,
      onProgress: progress,
      sleep: async () => {},
      now: () => 0
    });

    expect(result).toEqual({
      kind: "success",
      world: {
        id: "world-222",
        label: "Retry Two",
        spzUrl: "https://example.com/world-222.spz",
        collisionGlbUrl: "https://example.com/world-222.glb",
        source: "generated",
        worldLabsId: "world-222",
        promptText:
          "Generate a retry canyon world that functions as a map and scene for playing a shooter game. i.e it has a way for players to hide behind structures",
        worldMarbleUrl: "https://example.com/world-222",
        thumbnailUrl: undefined
      },
      attemptCount: 2,
      readinessSource: "world"
    });

    expect(progress).toHaveBeenNthCalledWith(1, {
      phase: "requesting",
      message: "Sending your prompt to World Labs.",
      operationId: null,
      worldId: null,
      attempt: 1,
      elapsedMs: 0,
      source: "operation"
    });
    expect(progress).toHaveBeenNthCalledWith(2, {
      phase: "retrying",
      message:
        "World Labs generated the splat world but did not provide a collider mesh. Retrying once with the same prompt.",
      operationId: "operation-1",
      worldId: "world-111",
      attempt: 2,
      elapsedMs: 0,
      source: "world"
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(consoleInfo).toHaveBeenCalled();
  });

  it("returns a terminal asset-unavailable failure after both attempts miss the collider", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          done: false,
          operation_id: "operation-1",
          metadata: {
            world_id: "world-111"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world_id: "world-111",
          display_name: "Retry One",
          world_marble_url: "https://example.com/world-111",
          assets: {
            mesh: {
              collider_mesh_url: null
            },
            splats: {
              spz_urls: {
                "500k": "https://example.com/world-111.spz"
              }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          done: false,
          operation_id: "operation-2",
          metadata: {
            world_id: "world-222"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world_id: "world-222",
          display_name: "Retry Two",
          world_marble_url: "https://example.com/world-222",
          assets: {
            mesh: {
              collider_mesh_url: null
            },
            splats: {
              spz_urls: {
                full_res: "https://example.com/world-222.spz"
              }
            }
          }
        })
      );

    const result = await generateWorldFromLocation("stalled harbor", {
      apiKey: "test-key",
      fetchFn,
      timeoutMs: 0,
      sleep: async () => {},
      now: () => 0
    });

    expect(result).toEqual({
      kind: "failed",
      code: "assets_unavailable",
      reason:
        "World Labs generated the splat world but did not provide a collider mesh, so shooter mode cannot start.",
      worldId: "world-222",
      operationId: "operation-2",
      worldMarbleUrl: "https://example.com/world-222",
      assetSummary:
        "worldId=world-222; assetKeys=mesh,splats; meshKeys=collider_mesh_url; collider_mesh_url=null; splatVariants=full_res",
      attemptCount: 2
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(consoleInfo).toHaveBeenCalled();
  });
});
