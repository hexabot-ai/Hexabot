/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Suspense } from "react";
import { useRoutes } from "react-router";

import { Progress } from "@/app-components/displays/Progress";
import { Layout } from "@/layout";

import { routes } from "./routes";
import { RouteObjectItem } from "./routes/routeConfig";

// `useRoutes` returns react-router's RouteContext provider, whose props carry
// the matched route. React 19 types expose `ReactElement.props` as `unknown`,
// so the shape has to be named explicitly.
type RouteContextElementProps = {
  match: { route: Pick<RouteObjectItem, "handle"> };
};

const App = () => {
  const element = useRoutes(routes);
  const { match } = element?.props as RouteContextElementProps;
  const { handle } = match.route;

  return (
    <Suspense fallback={<Progress />}>
      <Layout {...handle}>
        <>{element}</>
      </Layout>
    </Suspense>
  );
};

export default App;
