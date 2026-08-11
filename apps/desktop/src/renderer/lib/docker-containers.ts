import type { DockerContainerInfo } from "@janusgraph/domain";

export function graphServerContainers(containers: DockerContainerInfo[]): DockerContainerInfo[] {
  const matches = containers.filter((container) => {
    const serverImage = /(^|[/:_.-])janusgraph([/:_.-]|$)|gremlin[-_. ]?server/i.test(container.image);
    const serverName = /(^|[-_.])(janusgraph|gremlin)[-_.]?server($|[-_.])/i.test(container.name);
    return serverImage || serverName;
  });
  return matches.length > 0 ? matches : containers;
}
