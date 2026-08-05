"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  mergeNaiaPageContext,
  type NaiaPageContext,
  type NaiaPageContextDetail,
} from "./page-context";

type PublishedDetail = {
  detail: NaiaPageContextDetail;
  pathname: string;
};

type NaiaPageContextValue = {
  context: NaiaPageContext;
  publish: (detail: NaiaPageContextDetail) => void;
  reset: () => void;
};

const Context = createContext<NaiaPageContextValue | null>(null);

export function NaiaPageContextProvider({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string;
}) {
  const [published, setPublished] = useState<PublishedDetail | null>(null);

  const publish = useCallback(
    (detail: NaiaPageContextDetail) => {
      setPublished({ detail, pathname });
    },
    [pathname],
  );
  const reset = useCallback(() => setPublished(null), []);
  const context = useMemo(
    () =>
      mergeNaiaPageContext(
        pathname,
        published?.pathname === pathname ? published.detail : undefined,
      ),
    [pathname, published],
  );

  return (
    <Context.Provider value={{ context, publish, reset }}>
      {children}
    </Context.Provider>
  );
}

export function useNaiaPageContext() {
  const value = useContext(Context);
  if (!value) {
    throw new Error(
      "useNaiaPageContext must be used inside NaiaPageContextProvider",
    );
  }
  return value;
}

export function usePublishNaiaPageContext(detail: NaiaPageContextDetail) {
  const value = useContext(Context);
  const publish = value?.publish;
  const reset = value?.reset;
  const stableDetail = JSON.stringify(detail);

  useEffect(() => {
    if (!publish || !reset) return;

    publish(JSON.parse(stableDetail) as NaiaPageContextDetail);
    return reset;
  }, [publish, reset, stableDetail]);
}
