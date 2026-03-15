import { describe, expect, it, vi } from "vitest";

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

  it("prefers the 500k splat when multiple SPZ sizes are available", () => {
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

    expect(assets.spzUrl).toBe("https://example.com/500k.spz");
    expect(assets.collisionGlbUrl).toBe("https://example.com/collider.glb");
  });

  it("falls back from 500k to full_res to 100k", () => {
    expect(
      selectPreferredSpzUrl({
        full_res: "https://example.com/full.spz",
        "100k": "https://example.com/100k.spz"
      })
    ).toBe("https://example.com/full.spz");

    expect(
      selectPreferredSpzUrl({
        "100k": "https://example.com/100k.spz"
      })
    ).toBe("https://example.com/100k.spz");
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
  it("requests, polls, and returns a generated world definition", async () => {
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
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          done: true,
          operation_id: "operation-1",
          metadata: {
            world_id: "world-123"
          },
          response: {
            world_id: "world-123",
            display_name: "Snow Fortress",
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
          }
        })
      );

    const progress = vi.fn();
    const world = await generateWorldFromLocation("snow fortress", {
      apiKey: "test-key",
      fetchFn,
      onProgress: progress,
      sleep: async () => {},
      now: () => 0
    });

    expect(world).toMatchObject({
      id: "world-123",
      label: "Snow Fortress",
      spzUrl: "https://example.com/world.spz",
      collisionGlbUrl: "https://example.com/collider.glb",
      source: "generated",
      worldLabsId: "world-123"
    });

    expect(progress).toHaveBeenCalledWith({
      phase: "requesting",
      message: "Sending your prompt to World Labs.",
      operationId: null,
      worldId: null
    });
    expect(progress).toHaveBeenCalledWith({
      phase: "polling",
      message: "Generating a shooter-ready snow fortress world.",
      operationId: "operation-1",
      worldId: null
    });
    expect(progress).toHaveBeenCalledWith({
      phase: "polling",
      message: "World generation in progress.",
      operationId: "operation-1",
      worldId: "world-123"
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const firstRequest = fetchFn.mock.calls[0];
    expect(firstRequest[0]).toBe("https://api.worldlabs.ai/marble/v1/worlds:generate");
    expect(firstRequest[1]?.method).toBe("POST");
    expect(firstRequest[1]?.body).toBe(
      JSON.stringify({
        display_name: "Snow Fortress",
        model: "Marble 0.1-mini",
        world_prompt: {
          type: "text",
          text_prompt:
            "Generate a snow fortress world that functions as a map and scene for playing a shooter game. i.e it has a way for players to hide behind structures",
          disable_recaption: true
        }
      })
    );
  });

  it("surfaces validation errors from 422 responses", async () => {
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

    await expect(
      generateWorldFromLocation("misty harbor", {
        apiKey: "test-key",
        fetchFn
      })
    ).rejects.toThrow("body.world_prompt.type: Input should be 'text' or 'world_id'.");
  });

  it("surfaces World Labs operation errors", async () => {
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

    await expect(
      generateWorldFromLocation("orbital railyard", {
        apiKey: "test-key",
        fetchFn,
        sleep: async () => {},
        now: () => 0
      })
    ).rejects.toThrow("Insufficient credits.");
  });

  it("times out when polling exceeds the configured timeout", async () => {
    let currentTime = 0;
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
          operation_id: "operation-1"
        })
      );

    await expect(
      generateWorldFromLocation("lava refinery", {
        apiKey: "test-key",
        fetchFn,
        pollIntervalMs: 5_000,
        timeoutMs: 4_000,
        now: () => currentTime,
        sleep: async (ms) => {
          currentTime += ms;
        }
      })
    ).rejects.toThrow("World Labs generation timed out after 10 minutes. Please try again.");
  });

  it("falls back to GET /worlds/{id} when the completed operation lacks asset urls", async () => {
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
          metadata: {
            world_id: "world-999"
          },
          response: {
            world_id: "world-999",
            display_name: "Incomplete Snapshot",
            assets: {}
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world: {
            world_id: "world-999",
            display_name: "City Rooftops",
            world_marble_url: "https://example.com/world",
            world_prompt: {
              text_prompt: "A city rooftops shooter map."
            },
            assets: {
              thumbnail_url: "https://example.com/thumb.jpg",
              mesh: {
                collider_mesh_url: "https://example.com/collider.glb"
              },
              splats: {
                spz_urls: {
                  full_res: "https://example.com/full.spz"
                }
              }
            }
          }
        })
      );

    const world = await generateWorldFromLocation("city rooftops", {
      apiKey: "test-key",
      fetchFn,
      sleep: async () => {},
      now: () => 0
    });

    expect(world).toMatchObject({
      id: "world-999",
      label: "City Rooftops",
      spzUrl: "https://example.com/full.spz",
      collisionGlbUrl: "https://example.com/collider.glb",
      worldMarbleUrl: "https://example.com/world",
      thumbnailUrl: "https://example.com/thumb.jpg",
      promptText: "A city rooftops shooter map."
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[2]?.[0]).toBe("https://api.worldlabs.ai/marble/v1/worlds/world-999");
  });

  it("keeps polling the world record until the collider mesh export is available", async () => {
    let currentTime = 0;
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
          done: true,
          operation_id: "operation-1",
          metadata: {
            world_id: "world-777"
          },
          response: {
            world_id: "world-777",
            display_name: "Volcanic Citadel",
            assets: {
              splats: {
                spz_urls: {
                  "500k": "https://example.com/world.spz"
                }
              }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world: {
            world_id: "world-777",
            display_name: "Volcanic Citadel",
            assets: {
              splats: {
                spz_urls: {
                  "500k": "https://example.com/world.spz"
                }
              }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          world: {
            world_id: "world-777",
            display_name: "Volcanic Citadel",
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
          }
        })
      );

    const world = await generateWorldFromLocation("volcanic citadel", {
      apiKey: "test-key",
      fetchFn,
      pollIntervalMs: 5_000,
      now: () => currentTime,
      sleep: async (ms) => {
        currentTime += ms;
      },
      onProgress: progress
    });

    expect(world).toMatchObject({
      id: "world-777",
      label: "Volcanic Citadel",
      collisionGlbUrl: "https://example.com/collider.glb"
    });
    expect(progress).toHaveBeenCalledWith({
      phase: "polling",
      message: "World generated. Waiting for the collider mesh export to become available.",
      operationId: null,
      worldId: "world-777"
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});
