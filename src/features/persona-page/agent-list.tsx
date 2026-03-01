"use client";

import { FC, useMemo, useState, useCallback } from "react";
import { Search } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { PersonaCard } from "./persona-card/persona-card";
import { PersonaModel } from "./persona-services/models";

const PAGE_SIZE = 12;

interface AgentListProps {
  personas: PersonaModel[];
  initialFavoriteIds: string[];
  currentUserId: string;
  showContextMenu?: boolean;
}

export const AgentList: FC<AgentListProps> = ({
  personas,
  initialFavoriteIds,
  currentUserId,
  showContextMenu = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
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
    if (!searchQuery.trim()) return personas;
    const query = searchQuery.toLowerCase();
    return personas.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
    );
  }, [personas, searchQuery]);

  const favoritePersonas = useMemo(
    () => filteredPersonas.filter((p) => favoriteIds.has(p.id)),
    [filteredPersonas, favoriteIds]
  );

  const allPersonas = useMemo(
    () => filteredPersonas.filter((p) => !favoriteIds.has(p.id)),
    [filteredPersonas, favoriteIds]
  );

  const totalPages = Math.max(1, Math.ceil(allPersonas.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPersonas = allPersonas.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  return (
    <div>
      <div className="relative mb-6">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search agents by name or description..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {favoritePersonas.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Favorites</h2>
          <div className="grid grid-cols-3 gap-3">
            {favoritePersonas.map((persona) => (
              <PersonaCard
                persona={persona}
                key={persona.id}
                showContextMenu={showContextMenu}
                showActionMenu={persona.userId === currentUserId}
                isFavorited
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">
          {favoritePersonas.length > 0 ? "All Agents" : "Agents"}
        </h2>
        {paginatedPersonas.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {paginatedPersonas.map((persona) => (
              <PersonaCard
                persona={persona}
                key={persona.id}
                showContextMenu={showContextMenu}
                showActionMenu={persona.userId === currentUserId}
                isFavorited={false}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">
            {searchQuery
              ? "No agents match your search."
              : "No agents found."}
          </p>
        )}

        {totalPages > 1 && (
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
        )}
      </div>
    </div>
  );
};
