import { createElement, type ReactElement } from "react";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

const ROUTER: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

/**
 * `el` inside the router and pathname contexts the App Router provides, so a
 * client component that calls `useRouter()` or `usePathname()` renders with
 * renderToStaticMarkup.
 */
export function inAppRouter(el: ReactElement, pathname = "/"): ReactElement {
  return createElement(
    AppRouterContext.Provider,
    { value: ROUTER },
    createElement(PathnameContext.Provider, { value: pathname }, el)
  );
}
