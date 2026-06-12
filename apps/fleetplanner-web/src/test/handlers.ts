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
    }),
  ),
  http.get(`${API}/locations/search`, () => HttpResponse.json({ locations: [] })),
  http.get(`${API}/operations/:id`, ({ params }) =>
    HttpResponse.json(
      { error: { code: "not_found", message: `Operation ${String(params.id)} not found.`, requestId: "req-test" } },
      { status: 404 },
    ),
  ),
];
