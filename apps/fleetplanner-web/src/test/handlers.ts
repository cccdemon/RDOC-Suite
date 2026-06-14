import { http, HttpResponse } from "msw";
import { opDetailFixture, opSummaryFixture, sessionGuest } from "./fixtures";

const API = "/fleetplanner/api/v1";

export const handlers = [
  http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
  http.get(`${API}/operations`, () => HttpResponse.json({ operations: [opSummaryFixture] })),
  http.get(`${API}/operations/op_1`, () => HttpResponse.json(opDetailFixture)),
  http.get(`${API}/operations/:id/needs`, () =>
    HttpResponse.json({
      shipTypes: [
        { slug: "any", label: "Any ship" },
        { slug: "capital", label: "Capital" },
      ],
      cqbTeamMax: 8,
      cqbTeamDefault: 4,
      fighterSquadSize: 2,
      shipNeeds: [],
      fighterSquads: 0,
      cqbTeams: { count: 0, size: 4 },
      requirements: [],
    }),
  ),
  http.get(`${API}/locations/search`, () => HttpResponse.json({ locations: [] })),
  // default cover state (CoverPanel in OperatorConsole + wizard cover step)
  http.get(`${API}/operations/:id/cover`, () => HttpResponse.json({ serviceConfigured: false, cover: null })),
  // default empty channel list (wizard FR-C2 share step)
  http.get(`${API}/guilds/:id/channels`, () => HttpResponse.json({ channels: [] })),
  // default empty guild member list (seat picker + commanders); specific tests override
  http.get(`${API}/guilds/:id/settings`, ({ params }) =>
    HttpResponse.json({
      guild: { id: String(params.id), name: "RDOC", orgName: "RDOC", timezone: "Europe/Berlin", discordInviteUrl: null, admiralRoleId: null, ownerUserId: "x", canRemove: false },
      members: [],
    }),
  ),
  http.get(`${API}/operations/:id`, ({ params }) =>
    HttpResponse.json(
      { error: { code: "not_found", message: `Operation ${String(params.id)} not found.`, requestId: "req-test" } },
      { status: 404 },
    ),
  ),
];
