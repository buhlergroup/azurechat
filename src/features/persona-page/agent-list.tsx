"use client";

import { AgentStatsModel } from "@/features/common/services/agent-stats-models";
import Link from "next/link";
import { FC, useMemo, useState, useCallback } from "react";
import { Search, ShieldCheck, Store, VenetianMask } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { AgentSortSelect } from "./agent-sort-select";
import { AgentSortKey, sortAgents } from "./agent-sort";
import { PersonaCard } from "./persona-card/persona-card";
import { effectiveTrustLevel, PersonaModel } from "./persona-services/models";
import { personaStore } from "./persona-store";

const PAGE_SIZE = 12;

const NEW_AGENT_TEMPLATE = {
  name: "",
  personaMessage: `Instructions:
[Describe the instructions e.g. the tone of voice, the way the agent should respond, etc.]

Expertise:
[Describe the expertise of the agent e.g. Customer service, Marketing copywriter, etc.]

Example:
[Describe an example of the agent e.g. a Marketing copywriter who can write catchy headlines.]`,
  description: "",
  extensionIds: [],
};

type TrustFilter = "all" | "verified" | "community";

interface AgentListProps {
  personas: PersonaModel[];
  initialFavoriteIds: string[];
  currentUserId: string;
  showContextMenu?: boolean;
  agentStats?: Record<string, AgentStatsModel>;
  // Home screen mode: render only the favorites — discovery of other agents
  // happens in the marketplace / on the agents page.
  favoritesOnly?: boolean;
  // Current user may verify/downgrade/unpublish published agents.
  isVerifier?: boolean;
}

export const AgentList: FC<AgentListProps> = ({
  personas,
  initialFavoriteIds,
  currentUserId,
  showContextMenu = false,
  agentStats,
  favoritesOnly = false,
  isVerifier = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<AgentSortKey>("mostUsed");
  const [trustFilter, setTrustFilter] = useState<TrustFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => new Set(initialFavoriteIds)
  );

  const handleToggleFavorite = useCallback((agentId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }, []);

  const filteredPersonas = useMemo(() => {
    let result = sortAgents(personas, sortKey, agentStats);
    if (trustFilter !== "all") {
      result = result.filter(
        (p) => effectiveTrustLevel(p) === trustFilter
      );
    }
    if (!searchQuery.trim()) return result;
    const query = searchQuery.toLowerCase();
    return result.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
    );
  }, [personas, searchQuery, sortKey, trustFilter, agentStats]);

  const favoritePersonas = useMemo(
    () => filteredPersonas.filter((p) => favoriteIds.has(p.id)),
    [filteredPersonas, favoriteIds]
  );

  const allPersonas = useMemo(
    () => filteredPersonas.filter((p) => !favoriteIds.has(p.id)),
    [filteredPersonas, favoriteIds]
  );

  // On the home screen pagination applies to the favorites themselves;
  // otherwise favorites render in full and the "All Agents" grid paginates.
  const paginatedSource = favoritesOnly ? favoritePersonas : allPersonas;
  const totalPages = Math.max(1, Math.ceil(paginatedSource.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPersonas = paginatedSource.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleSortChange = (value: AgentSortKey) => {
    setSortKey(value);
    setCurrentPage(1);
  };

  const pagination = totalPages > 1 && (
    <div className="flex items-center justify-center gap-4 mt-6">
      <Button
        variant="outline"
        size="sm"
        disabled={safePage <= 1}
        onClick={() => setCurrentPage(safePage - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {safePage} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={safePage >= totalPages}
        onClick={() => setCurrentPage(safePage + 1)}
      >
        Next
      </Button>
    </div>
  );

  const handleTrustFilterChange = (value: TrustFilter) => {
    setTrustFilter(value);
    setCurrentPage(1);
  };

  const renderCard = (persona: PersonaModel, isFavorited: boolean) => (
    <PersonaCard
      persona={persona}
      key={persona.id}
      showContextMenu={showContextMenu}
      showActionMenu={persona.userId === currentUserId}
      isFavorited={isFavorited}
      onToggleFavorite={handleToggleFavorite}
      isVerifier={isVerifier}
      stats={agentStats?.[persona.id]}
    />
  );

  if (favoritesOnly) {
    return (
      <div>
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              id="agent-search"
              name="agent-search"
              placeholder="Search agents by name or description..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <AgentSortSelect value={sortKey} onChange={handleSortChange} />
          <Button asChild variant="secondary" className="gap-2 shrink-0">
            <Link href="/agent">
              <Store className="h-4 w-4" />
              Browse all agents
            </Link>
          </Button>
        </div>

        <h2 className="text-2xl font-bold mb-3">Favorites</h2>
        {paginatedPersonas.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginatedPersonas.map((persona) => renderCard(persona, true))}
            </div>
            {pagination}
          </>
        ) : searchQuery ? (
          <p className="text-muted-foreground">No agents match your search.</p>
        ) : (
          <div className="border rounded-md p-8 flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">
              You haven&apos;t added any agents yet.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild className="gap-2">
                <Link href="/agent">
                  <Store className="h-4 w-4" />
                  Browse all agents
                </Link>
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => personaStore.newPersonaAndOpen(NEW_AGENT_TEMPLATE)}
              >
                <VenetianMask className="h-4 w-4" />
                Create Agent
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            id="agent-search"
            name="agent-search"
            placeholder="Search agents by name or description..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <Select
          value={trustFilter}
          onValueChange={(value) =>
            handleTrustFilterChange(value as TrustFilter)
          }
        >
          <SelectTrigger
            className="w-full sm:w-[150px]"
            aria-label="Filter by trust level"
          >
            {/* grouped in a div — the trigger's justify-between would
                otherwise spread icon and label apart */}
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Trust" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="community">Community</SelectItem>
          </SelectContent>
        </Select>
        <AgentSortSelect value={sortKey} onChange={handleSortChange} />
      </div>

      {favoritePersonas.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Favorites</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {favoritePersonas.map((persona) => renderCard(persona, true))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold mb-3">
          {favoritePersonas.length > 0 ? "All Agents" : "Agents"}
        </h2>
        {paginatedPersonas.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paginatedPersonas.map((persona) => renderCard(persona, false))}
          </div>
        ) : searchQuery || trustFilter !== "all" ? (
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground">
              No agents match your {searchQuery ? "search" : "filter"}.
            </p>
            {trustFilter !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleTrustFilterChange("all")}
              >
                Clear filter
              </Button>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">No agents found.</p>
        )}

        {pagination}
      </div>
    </div>
  );
};
