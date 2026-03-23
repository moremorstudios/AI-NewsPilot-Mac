// FILE: src/app/router.js
export function getCurrentRoute(){
  const hash = window.location.hash || "#/";
  if (hash.startsWith("#/")) return hash.slice(2);
  return "/";
}

export function navigateTo(route){
  if (!route.startsWith("/")) route = "/" + route;
  window.location.hash = route;
}

export function onRouteChange(cb){
  window.addEventListener("hashchange", ()=>cb(getCurrentRoute()));
}
