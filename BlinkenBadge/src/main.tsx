// Copyright 2026 Martin Bogomolni
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { mobileHost } from "./mobile/host";

const DesktopApp = lazy(() => import("./App"));
const MobileApp = lazy(() => import("./mobile/MobileApp"));
const App = mobileHost ? MobileApp : DesktopApp;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={<p role="status">Opening BlinkenBadge...</p>}>
      <App />
    </Suspense>
  </React.StrictMode>,
);
