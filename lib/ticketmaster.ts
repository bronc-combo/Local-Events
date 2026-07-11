import { getOfficialVenueEvents } from "@/lib/event-sources";

// Deprecated shim: keep this file around so older imports do not break while
// the app transitions from Ticketmaster to official venue-source ingestion.
export const getEventProviderResult = getOfficialVenueEvents;
