// A simple, greedy opponent: good enough to fill an empty seat and keep the
// game moving, not to win tournaments. Pure: it reads a state, returns a move.

import { TERRAIN_RESOURCE, rollWays, type Resource } from "./board";
import {
    COSTS,
    RESOURCES,
    canAfford,
    canPlaceConduit,
    handFrom,
    handSize,
    legalColonySpots,
    legalConduitSpots,
    legalTowerSpots,
    piecesLeft,
    stealTargets,
    tradeRatio,
    victoryPoints,
    waitingOn,
    type BuildKind,
    type GameState,
    type Hand,
    type Move,
} from "./game";
import { otherEnd } from "./graph";

/** How good a vertex is: pips of its tiles, with a bonus for variety. */
function vertexValue(s: GameState, v: number, p: number): number {
    const seen = new Set<Resource>();
    let pips = 0;
    for (const t of s.topology.vertices[v].tiles) {
        const tile = s.board.tiles[t];
        const r = TERRAIN_RESOURCE[tile.terrain];
        if (!r || tile.number === null) continue;
        const w = rollWays(tile.number) * (t === s.drone ? 0.3 : 1);
        pips += w;
        if (!seen.has(r)) seen.add(r);
    }
    let value = pips + seen.size * 1.5;
    // Value what we lack.
    const have = producedBy(s, p);
    for (const r of seen) if (!have.has(r)) value += 1.5;
    if (s.topology.harbors.some((h) => [s.topology.edges[h.edge].a, s.topology.edges[h.edge].b].includes(v))) value += 1;
    return value;
}

function producedBy(s: GameState, p: number) {
    const out = new Set<Resource>();
    for (const [v, b] of Object.entries(s.buildings)) {
        if (b.owner !== p) continue;
        for (const t of s.topology.vertices[Number(v)].tiles) {
            const r = TERRAIN_RESOURCE[s.board.tiles[t].terrain];
            if (r) out.add(r);
        }
    }
    return out;
}

function best<T>(items: T[], score: (x: T) => number): T | undefined {
    let top: T | undefined;
    let topScore = -Infinity;
    for (const x of items) {
        const sc = score(x);
        if (sc > topScore) {
            topScore = sc;
            top = x;
        }
    }
    return top;
}

/** The next move for bot `p`, or null if it has nothing to do right now. */
export function botMove(s: GameState, p: number): Move | null {
    if (s.phase === "over" || !waitingOn(s).includes(p)) return null;
    const h = s.players[p].hand!;

    // Answering someone else's offer.
    if (s.trade && s.trade.from !== p && !s.trade.responses[p]) {
        return { type: "respondTrade", player: p, accept: wantsTrade(s, p, s.trade.give, s.trade.want) };
    }

    if (s.step === "discard" && s.discards[p] !== undefined) {
        const cards = handFrom({});
        const left = { ...h };
        for (let i = 0; i < s.discards[p]; i++) {
            const r = best(RESOURCES.filter((x) => left[x] > 0), (x) => left[x])!;
            left[r]--;
            cards[r]++;
        }
        return { type: "discard", player: p, cards };
    }

    if (p !== s.current) return null;

    if (s.trade && s.trade.from === p) {
        const yes = Object.entries(s.trade.responses).find(([, r]) => r === "accept");
        return yes ? { type: "confirmTrade", player: p, with: Number(yes[0]) } : { type: "cancelTrade", player: p };
    }

    switch (s.step) {
        case "setupColony": {
            const v = best(legalColonySpots(s, p), (v) => vertexValue(s, v, p))!;
            return { type: "placeColony", player: p, vertex: v };
        }
        case "setupConduit":
        case "printer": {
            const e = bestConduit(s, p);
            if (e === undefined) return s.step === "printer" ? null : null;
            return { type: "placeConduit", player: p, edge: e };
        }
        case "roll": {
            // Clear the drone off our own land before rolling.
            if (s.players[p].tech!.includes("drone") && !s.playedTechThisTurn && droneHurtsUs(s, p)) {
                return { type: "playTech", player: p, card: "drone" };
            }
            return { type: "roll", player: p };
        }
        case "moveDrone":
            return { type: "moveDrone", player: p, tile: droneTarget(s, p) };
        case "steal": {
            const victim = best(s.stealFrom, (o) => s.players[o].handCount + victoryPoints(s, o, false) * 2)!;
            return { type: "steal", player: p, victim };
        }
        case "main":
            return mainMove(s, p, h);
    }
    return null;
}

function mainMove(s: GameState, p: number, h: Hand): Move {
    const left = piecesLeft(s, p);
    const pl = s.players[p];

    // Play a tech card when it clearly helps.
    if (!s.playedTechThisTurn && pl.tech!.length) {
        if (pl.tech!.includes("printer") && legalConduitSpots(s, p).length >= 2 && left.conduit >= 2) {
            return { type: "playTech", player: p, card: "printer" };
        }
        if (pl.tech!.includes("extraction")) {
            const need = missingFor(h, nextGoal(s, p, h) ?? "colony");
            const rs = RESOURCES.filter((r) => need[r] > 0).flatMap((r) => Array<Resource>(need[r]).fill(r));
            while (rs.length < 2) rs.push(best(RESOURCES, (r) => -h[r])!);
            if (rs.slice(0, 2).every((r) => s.bank[r] > 0)) return { type: "playTech", player: p, card: "extraction", resources: rs.slice(0, 2) };
        }
        if (pl.tech!.includes("monopoly")) {
            const r = best(RESOURCES, (r) => s.players.reduce((n, o, i) => n + (i === p ? 0 : o.handCount ? 1 : 0), 0) + (h[r] === 0 ? 1 : 0));
            const total = s.players.reduce((n, o, i) => n + (i === p ? 0 : o.handCount), 0);
            if (r && total >= 6) return { type: "playTech", player: p, card: "monopoly", resource: r };
        }
        if (pl.tech!.includes("drone") && droneHurtsUs(s, p)) return { type: "playTech", player: p, card: "drone" };
    }

    // Build, most valuable first.
    if (left.tower > 0 && canAfford(h, COSTS.tower)) {
        const v = best(legalTowerSpots(s, p), (v) => vertexValue(s, v, p));
        if (v !== undefined) return { type: "upgradeTower", player: p, vertex: v };
    }
    const colonySpots = legalColonySpots(s, p);
    if (left.colony > 0 && canAfford(h, COSTS.colony) && colonySpots.length) {
        const v = best(colonySpots, (v) => vertexValue(s, v, p))!;
        return { type: "placeColony", player: p, vertex: v };
    }
    if (left.conduit > 0 && canAfford(h, COSTS.conduit) && (!colonySpots.length || left.colony === 0) && conduitCount(s, p) < 13) {
        const e = bestConduit(s, p);
        if (e !== undefined) return { type: "placeConduit", player: p, edge: e };
    }
    if (canAfford(h, COSTS.tech) && s.deck.length && !canAfford(h, COSTS.colony)) {
        return { type: "buyTech", player: p };
    }

    // Trade surplus with the bank towards the next goal.
    const goal = nextGoal(s, p, h);
    if (goal) {
        const need = missingFor(h, goal);
        const want = RESOURCES.find((r) => need[r] > 0 && s.bank[r] > 0);
        if (want) {
            const cost = handFrom(COSTS[goal]);
            const give = RESOURCES.find((r) => r !== want && h[r] - cost[r] >= tradeRatio(s, p, r));
            if (give) return { type: "bankTrade", player: p, give, get: want };
        }
    }
    return { type: "endTurn", player: p };
}

function conduitCount(s: GameState, p: number) {
    return Object.values(s.conduits).filter((o) => o === p).length;
}

/** What to save up for. */
function nextGoal(s: GameState, p: number, h: Hand): BuildKind | null {
    const left = piecesLeft(s, p);
    if (left.tower > 0 && legalTowerSpots(s, p).length && handSize(missingFor(h, "tower")) <= 2) return "tower";
    if (left.colony > 0 && legalColonySpots(s, p).length) return "colony";
    if (left.tower > 0 && legalTowerSpots(s, p).length) return "tower";
    if (left.conduit > 0 && legalConduitSpots(s, p).length) return "conduit";
    if (s.deck.length) return "tech";
    return null;
}

function missingFor(h: Hand, kind: BuildKind): Hand {
    const cost = handFrom(COSTS[kind]);
    return handFrom(Object.fromEntries(RESOURCES.map((r) => [r, Math.max(0, cost[r] - h[r])])));
}

/** A conduit that leads towards the best free colony spot. */
function bestConduit(s: GameState, p: number): number | undefined {
    const spots = legalConduitSpots(s, p);
    if (!spots.length) return undefined;
    const free = (v: number) => !s.buildings[v] && s.topology.vertices[v].neighbors.every((n) => !s.buildings[n]);
    return best(spots, (e) => {
        const edge = s.topology.edges[e];
        // Score the far end: a free spot is worth its value, else look one step further.
        let score = 0;
        for (const v of [edge.a, edge.b]) {
            if (free(v)) score = Math.max(score, vertexValue(s, v, p) + 2);
            for (const e2 of s.topology.vertices[v].edges) {
                if (e2 === e) continue;
                const w = otherEnd(s.topology, e2, v);
                if (free(w) && canPlaceConduitSoon(s, p, e2)) score = Math.max(score, vertexValue(s, w, p) * 0.7);
            }
        }
        // Ties go to the lower id, so bots stay deterministic.
        return score - e * 1e-6;
    });
}

function canPlaceConduitSoon(s: GameState, p: number, e: number) {
    return s.conduits[e] === undefined || canPlaceConduit(s, p, e);
}

function droneHurtsUs(s: GameState, p: number) {
    return s.topology.tileVertices[s.drone].some((v) => s.buildings[v]?.owner === p);
}

/** The rival tile that hurts the leader most, away from our own buildings. */
function droneTarget(s: GameState, p: number): number {
    const leader = best(
        s.players.map((_, i) => i).filter((i) => i !== p),
        (i) => victoryPoints(s, i, false),
    )!;
    const options = s.board.tiles.map((_, i) => i).filter((i) => i !== s.drone);
    return best(options, (t) => {
        const tile = s.board.tiles[t];
        const ways = tile.number ? rollWays(tile.number) : 0;
        let score = 0;
        for (const v of s.topology.tileVertices[t]) {
            const b = s.buildings[v];
            if (!b) continue;
            if (b.owner === p) score -= 20;
            else score += ways * (b.kind === "tower" ? 2 : 1) * (b.owner === leader ? 1.5 : 1);
        }
        if (stealTargets(s, p, t).length) score += 2;
        return score;
    })!;
}

function wantsTrade(s: GameState, p: number, theyGive: Hand, theyWant: Hand) {
    const h = s.players[p].hand!;
    if (!canAfford(h, theyWant)) return false;
    // Don't feed someone about to win.
    if (victoryPoints(s, s.trade!.from, false) >= 8) return false;
    const goal = nextGoal(s, p, h);
    if (!goal) return false;
    const need = missingFor(h, goal);
    const helps = RESOURCES.some((r) => theyGive[r] > 0 && need[r] > 0);
    const cost = handFrom(COSTS[goal]);
    const hurts = RESOURCES.some((r) => theyWant[r] > 0 && h[r] - theyWant[r] < cost[r]);
    return helps && !hurts && handSize(theyGive) >= handSize(theyWant);
}
