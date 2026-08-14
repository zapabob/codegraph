#!/usr/bin/env python3
"""Plan and apply a reproducible merge from an official Git upstream.

The default mode is read-only: it records the exact merge base, commit
distance, path overlap, and Git's merge-tree conflict forecast as JSON.  Pass
``--apply`` only after reviewing that plan; it starts a no-commit merge so
conflicts remain visible for explicit resolution and review.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence


@dataclass(frozen=True)
class CommandResult:
    """The relevant, serializable result of one Git command."""

    args: list[str]
    returncode: int
    stdout: str
    stderr: str


class GitCommandError(RuntimeError):
    """Raised when a required Git command fails."""


def run_git(repo: Path, args: Sequence[str], *, check: bool = True) -> CommandResult:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    command_result = CommandResult(
        args=["git", "-C", str(repo), *args],
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
    )
    if check and result.returncode:
        raise GitCommandError(
            "Git command failed:\n"
            f"  {' '.join(command_result.args)}\n"
            f"  {command_result.stderr.strip() or command_result.stdout.strip()}"
        )
    return command_result


def resolve_repo(path: str) -> Path:
    candidate = Path(path).resolve()
    root = run_git(candidate, ["rev-parse", "--show-toplevel"]).stdout.strip()
    return Path(root).resolve()


def resolve_commit(repo: Path, ref: str) -> str:
    return run_git(repo, ["rev-parse", "--verify", f"{ref}^{{commit}}"]).stdout.strip()


def changed_paths(repo: Path, revision_range: str) -> list[str]:
    output = run_git(repo, ["diff", "--name-only", revision_range]).stdout
    return sorted(path for path in output.splitlines() if path)


def conflict_paths(merge_tree_output: str) -> list[str]:
    matches = re.findall(r"^CONFLICT \([^\n]+\): Merge conflict in (.+)$", merge_tree_output, re.M)
    return sorted(set(matches))


def build_plan(repo: Path, upstream_ref: str) -> dict[str, object]:
    head = resolve_commit(repo, "HEAD")
    upstream = resolve_commit(repo, upstream_ref)
    base = run_git(repo, ["merge-base", head, upstream]).stdout.strip()
    ahead_behind = run_git(repo, ["rev-list", "--left-right", "--count", f"{head}...{upstream}"])
    ahead, behind = (int(value) for value in ahead_behind.stdout.split())

    fork_paths = changed_paths(repo, f"{base}..{head}")
    upstream_paths = changed_paths(repo, f"{base}..{upstream}")
    overlaps = sorted(set(fork_paths).intersection(upstream_paths))
    merge_tree = run_git(repo, ["merge-tree", "--write-tree", head, upstream], check=False)

    return {
        "repository": str(repo),
        "head": head,
        "upstream_ref": upstream_ref,
        "upstream": upstream,
        "merge_base": base,
        "ahead": ahead,
        "behind": behind,
        "fork_only_paths": fork_paths,
        "upstream_paths_count": len(upstream_paths),
        "overlapping_paths": overlaps,
        "merge_tree": {
            "returncode": merge_tree.returncode,
            "conflict_paths": conflict_paths(merge_tree.stdout),
            "output": merge_tree.stdout.strip(),
            "stderr": merge_tree.stderr.strip(),
        },
    }


def require_clean_worktree(repo: Path) -> None:
    status = run_git(repo, ["status", "--porcelain"]).stdout
    if status:
        raise GitCommandError(
            "Refusing to apply the merge with a dirty worktree:\n" + status.rstrip()
        )


def write_report(plan: dict[str, object], report_path: str | None) -> None:
    rendered = json.dumps(plan, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if report_path:
        Path(report_path).resolve().write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=".",
        help="repository or worktree to inspect (default: current directory)",
    )
    parser.add_argument(
        "--upstream-ref",
        default="upstream/main",
        help="fetched official revision to merge (default: upstream/main)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="start git merge --no-ff --no-commit after writing the plan",
    )
    parser.add_argument(
        "--report",
        help="optional JSON report path; defaults to stdout",
    )
    args = parser.parse_args()

    try:
        repo = resolve_repo(args.repo)
        plan = build_plan(repo, args.upstream_ref)
        if args.apply:
            require_clean_worktree(repo)
            merge = run_git(
                repo,
                ["merge", "--no-ff", "--no-commit", args.upstream_ref],
                check=False,
            )
            plan["apply"] = asdict(merge)
            plan["post_merge_status"] = run_git(
                repo, ["status", "--short"]
            ).stdout.splitlines()
        write_report(plan, args.report)
        return 0 if not args.apply or plan["apply"]["returncode"] == 0 else 1
    except (GitCommandError, OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
