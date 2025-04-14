import { useState, useEffect } from "react";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import { getGraphClient } from "../services/microsoft-graph-client";

export const useProfilePicture = (token: string | undefined): string => {
    const [profilePicture, setProfilePicture] = useState<string>("");

    useEffect(() => {
        const fetchProfilePicture = async () => {
            if (!token) {
                setProfilePicture("");
                return;
            }

            const client = getGraphClient(token);

            try {
                const profilePictureData = await client
                    .api("/me/photo/$value")
                    .responseType(ResponseType.ARRAYBUFFER)
                    .get();

                const pictureBase64 = Buffer.from(profilePictureData).toString("base64");
                setProfilePicture(`data:image/jpeg;base64, ${pictureBase64}`);
            } catch (error) {
                setProfilePicture("");
            }
        };

        fetchProfilePicture();
    }, [token]);

    return profilePicture;
};