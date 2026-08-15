import { getGithubUser } from "../services/github_user_service";

export async function getGitAuthor() {
  const user = await getGithubUser();
  const author = user
    ? {
        name: "Dyad",
        email: user.email,
      }
    : {
        name: "Dyad",
        email: "git@dyad.sh",
      };
  return author;
}
