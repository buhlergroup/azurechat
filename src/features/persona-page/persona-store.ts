import { proxy, useSnapshot } from "valtio";
import { RevalidateCache } from "../common/navigation-helpers";
import {
  PERSONA_ATTRIBUTE,
  PersonaModel,
  SharePointFile,
} from "./persona-services/models";
import {
  CreatePersona,
  UpsertPersona,
} from "./persona-services/persona-service";

class PersonaState {
  private defaultModel: PersonaModel = {
    id: "",
    name: "",
    description: "",
    personaMessage: "",
    createdAt: new Date(),
    isPublished: false,
    type: "PERSONA",
    userId: "",
    extensionIds: [],
  };

  public isOpened: boolean = false;
  public errors: string[] = [];
  public persona: PersonaModel = { ...this.defaultModel };

  public addExtension(id: string): void {
    if (!this.persona.extensionIds) {
      this.persona.extensionIds = [];
    }
    this.persona.extensionIds.push(id);
  }

  public removeExtension(id: string): void {
    if (!this.persona.extensionIds) {
      return;
    }
    this.persona.extensionIds = this.persona.extensionIds.filter(
      (e) => e !== id
    );
  }

  public updateOpened(value: boolean) {
    this.isOpened = value;
  }

  public updatePersona(persona: PersonaModel) {
    this.persona = {
      ...persona,
    };
    this.isOpened = true;
  }

  public newPersona() {
    this.persona = {
      ...this.defaultModel,
    };
    this.isOpened = true;
  }

  public newPersonaAndOpen(persona: {
    name: string;
    description: string;
    personaMessage: string;
    extensionIds: string[];
  }) {
    this.persona = {
      ...this.defaultModel,
      name: persona.name,
      description: persona.description,
      personaMessage: persona.personaMessage,
      extensionIds: persona.extensionIds,
    };
    this.isOpened = true;
  }

  public updateErrors(errors: string[]) {
    this.errors = errors;
  }
}

export const personaStore = proxy(new PersonaState());

export const usePersonaState = () => {
  return useSnapshot(personaStore, { sync: true });
};

export const addOrUpdatePersona = async (previous: any, formData: FormData) => {
  const sharePointFiles = handleSharePointFiles(formData);
  const model = FormDataToPersonaModel(formData);

  if (personaStore.persona.extensionIds) {
    model.extensionIds = personaStore.persona.extensionIds.map((e) => e);
  }

  const response =
    model.id && model.id !== ""
      ? await UpsertPersona(model, sharePointFiles)
      : await CreatePersona(model, sharePointFiles);

  if (response.status === "OK") {
    personaStore.updateOpened(false);
    RevalidateCache({
      page: "persona",
    });
  }

  return response;
};

const handleSharePointFiles = (formData: FormData): SharePointFile[] => {
  const filesObjStrings = formData.getAll(
    "selectedSharePointDocumentIds"
  ) as string[];

  if (!filesObjStrings || filesObjStrings[0].length === 0) return [];
  
  const fileObj = JSON.parse(filesObjStrings[0]) as SharePointFile[];
  return Array.isArray(fileObj) ? fileObj : [];
};

const FormDataToPersonaModel = (formData: FormData): PersonaModel => {
  return {
    id: formData.get("id") as string,
    name: formData.get("name") as string,
    description: formData.get("description") as string,
    personaMessage: formData.get("personaMessage") as string,
    isPublished: formData.get("isPublished") === "on" ? true : false,
    userId: "", // the user id is set on the server once the user is authenticated
    extensionIds: formData.getAll("extensionIds") as string[],
    createdAt: new Date(),
    type: PERSONA_ATTRIBUTE,
    accessGroup: {
      id: formData.get("accessGroupId") as string,
      source: "SHAREPOINT",
    },
    personaDocumentIds: formData.getAll("personaDocumentIds") as string[],
  };
};
