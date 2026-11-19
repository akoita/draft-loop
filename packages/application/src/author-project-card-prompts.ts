/*
 * Prompt text of `cli-author-v20` (#2897). A project card is career evidence about one code
 * repository that the candidate's agent counted from git and the candidate approved. Its source
 * opens with a "Project: ..." heading; a public card ends with a "Project and links" list, while a
 * private card's links never reach the author. v19 stays unchanged for runs that recorded it.
 */

/** Added to the author prompt from `cli-author-v20`; it never overrides the grounding rules. */
export const projectCardInstructions =
  " A retrieved source headed Project: is a project card: one code repository the candidate built or worked on. When the job values it, write the project once, in a Projects section unless it belongs inside a role, as a project line followed by bullets that cite the card. The project line holds the project's name, what it is and, when the card's Project and links section lists a Repository or any other URL, that URL copied exactly, citing the chunk that holds it; a project line that leaves out a listed URL is incomplete. Write the name without the card's visibility label: never write (public), (private) or (unknown) in the CV. A card without a Project and links section gets no link and no repository name beyond the card's own project name. Use a card's numbers (commits, pull requests, releases, stars) exactly as the card states them, or leave them out; never round, combine or derive a new figure from them. This guidance does not override the grounding rules, the one-page counts, the required sections, context.writingPolicy or this system message.";
