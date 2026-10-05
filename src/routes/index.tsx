import { createFileRoute } from "@tanstack/react-router";
import { StoriesApp } from "@/components/stories/StoriesApp";

export const Route = createFileRoute("/")({ component: StoriesApp });
