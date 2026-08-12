import type { CompatibilityProfile } from "@janusgraph/domain";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./presentation";

export function useCompatibilityProfile(connectionId: string | undefined) {
  const [profile, setProfile] = useState<CompatibilityProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(connectionId));
  const [message, setMessage] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (!connectionId || !window.janusGraphDesktop) {
      setProfile(null);
      setLoading(false);
      setMessage("");
      return null;
    }
    setLoading(true);
    setMessage("");
    try {
      const next = await window.janusGraphDesktop.compatibility.get(connectionId, refresh);
      setProfile(next);
      return next;
    } catch (error) {
      setProfile(null);
      setMessage(errorMessage(error));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    let active = true;
    if (!connectionId || !window.janusGraphDesktop) {
      setProfile(null);
      setLoading(false);
      setMessage("");
      return;
    }
    setLoading(true);
    setMessage("");
    void window.janusGraphDesktop.compatibility.get(connectionId).then(
      (next) => {
        if (!active) return;
        setProfile(next);
        setLoading(false);
      },
      (error) => {
        if (!active) return;
        setProfile(null);
        setMessage(errorMessage(error));
        setLoading(false);
      },
    );
    return () => { active = false; };
  }, [connectionId]);

  return { profile, loading, message, refresh: () => load(true) };
}
