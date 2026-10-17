import belgium from './data/belgium.json' with { type: 'json' };
import czech from './data/czech.json' with { type: 'json' };
import finland from './data/finland.json' with { type: 'json' };
import germany from './data/germany.json' with { type: 'json' };
import route from './data/map-locations.json' with { type: 'json' };
import spain from './data/spain.json' with { type: 'json' };
import sweden from './data/sweden.json' with { type: 'json' };

export const itinerarySource = Object.freeze({
  countries: Object.freeze({
    spain,
    finland,
    sweden,
    belgium,
    germany,
    czech
  }),
  route
});
