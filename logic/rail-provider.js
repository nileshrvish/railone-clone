/**
 * rail-provider.js — loads the network JSON and builds MumbaiRail exactly
 * once, at module scope, and shares that single instance with anyone who
 * imports getRail(). MumbaiRail builds an index + graph on construction, so
 * it must not be constructed per render or per request.
 */
import { MumbaiRail } from '../mumbai-rail.js';

let railPromise = null;

export function getRail() {
  if (!railPromise) {
    railPromise = MumbaiRail.load('./data/mumbai_suburban_rail.json');
  }
  return railPromise;
}
