import type { ScreenProps } from "../../app/routes";
import { Detail } from "./Detail";
import { Portfolio } from "./Portfolio";
import "./projects.css";

export default function ProjectsScreen({ params }: ScreenProps) {
  return params.id ? <Detail key={params.id} id={params.id} /> : <Portfolio />;
}
