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

/**
 * Where to support the project.
 *
 * Desktop and web only. The iOS and Android builds leave it out: both stores
 * treat a tip to the developer as a purchase that has to go through their own
 * billing, and an outside link for one is a rejection.
 *
 * The desktop opens it with the open_support command, which has the same
 * address built in and takes no argument, so the page cannot open anything
 * else through it.
 */
export const SUPPORT_URL = "https://ko-fi.com/martinbogo";
