"use client";

import { useRouter, useParams } from "next/navigation";
import { showError } from "@/features/globals/global-message-store";
import {
  CreatePersonaChat,
  FindPersonaByID,
} from "@/features/persona-page/persona-services/persona-service";
import { DisplayError } from "@/features/ui/error/display-error";
import { LoadingIndicator } from "@/features/ui/loading";
import { PersonaModel } from "@/features/persona-page/persona-services/models";
import React, { useEffect, useState } from "react";

const CreatePersonaChatPage = () => {
  const { personaId } = useParams();
  const [persona, setPersona] = useState<PersonaModel | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchPersona = async (): Promise<void> => {
      if (!personaId) {
        setErrors(["Persona ID is missing"]);
        return;
      }

      try {
        const personasResponse = await FindPersonaByID(personaId as string);

        if (personasResponse.status === "UNAUTHORIZED") {
          router.push("/persona/access-denied");
          return;
        }

        if (personasResponse.status !== "OK") {
          setErrors(personasResponse.errors.map((error) => error.message));
          return;
        }

        setPersona(personasResponse.response);
      } catch (error) {
        setErrors(["An unexpected error occurred while fetching the persona"]);
      }
    };

    fetchPersona();
  }, [personaId, router]);

  useEffect(() => {
    const startChat = async (): Promise<void> => {
      if (!persona) return;

      try {
        const response = await CreatePersonaChat(persona.id as string);

        if (response.status === "OK") {
          router.push(`/chat/${response.response.id}`);
        } else if (response.status === "UNAUTHORIZED") {
          router.push("/persona/access-denied");
        } else {
          showError(response.errors.map((error) => error.message).join(", "));
        }
      } catch (error) {
        showError("An unexpected error occurred while starting the chat.");
      }
    };

    startChat();
  }, [persona, router]);

  if (errors) {
    return <DisplayError errors={errors.map((error) => ({ message: error }))} />;
  }

  if (!persona) {
    return (
      <div className="container w-full h-full flex items-center justify-center">
        <LoadingIndicator isLoading />
      </div>
    );
  }

  return (
    <div className="container w-full h-full flex items-center justify-center">
      <LoadingIndicator isLoading />
    </div>
  );
};

export default CreatePersonaChatPage;