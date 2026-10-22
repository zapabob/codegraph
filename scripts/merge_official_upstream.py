#!/usr/bin/env python3
"""Plan and apply a reproducible merge from an official Git upstream.

The default mode is read-only: it records the exact merge base, commit
distance, path overlap, and Git's merge-tree conflict forecast as JSON.  Pass
``--apply`` only after reviewing that plan; it starts a no-commit merge so
conflicts remain visible for explicit resolution and review. ``--fetch``
refreshes upstream/main first; ``--verify`` checks a resolved merge against
the pinned upstream and ensures fork-exclusive files are still present.
``--advance`` applies a descendant upstream update to a reviewed, fully staged
pending merge without discarding its existing conflict resolutions.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
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
    return run_git(
        repo, ["rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"]
    ).stdout.strip()


def changed_paths(repo: Path, revision_range: str) -> list[str]:
    output = run_git(repo, ["diff", "--name-only", revision_range]).stdout
    return sorted(path for path in output.splitlines() if path)


def conflict_paths(merge_tree_output: str) -> list[str]:
    matches = re.findall(
        r"^CONFLICT \([^\n]+\): Merge conflict in (.+)$", merge_tree_output, re.M
    )
    return sorted(set(matches))


def build_plan(repo: Path, upstream_ref: str) -> dict[str, object]:
    head = resolve_commit(repo, "HEAD")
    upstream = resolve_commit(repo, upstream_ref)
    base = run_git(repo, ["merge-base", head, upstream]).stdout.strip()
    ahead_behind = run_git(
        repo, ["rev-list", "--left-right", "--count", f"{head}...{upstream}"]
    )
    ahead, behind = (int(value) for value in ahead_behind.stdout.split())

    fork_paths = changed_paths(repo, f"{base}..{head}")
    upstream_paths = changed_paths(repo, f"{base}..{upstream}")
    overlaps = sorted(set(fork_paths).intersection(upstream_paths))
    merge_tree = run_git(
        repo, ["merge-tree", "--write-tree", head, upstream], check=False
    )
    if merge_tree.returncode not in (0, 1):
        raise GitCommandError(
            "Cannot forecast the merge: "
            + (merge_tree.stderr.strip() or merge_tree.stdout.strip())
        )

    return {
        "repository": str(repo),
        "head": head,
        "upstream_ref": upstream_ref,
        "upstream": upstream,
        "merge_base": base,
        "ahead": ahead,
        "behind": behind,
        "fork_only_paths": fork_paths,
        "fork_exclusive_paths": sorted(set(fork_paths).difference(upstream_paths)),
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


def advance_merge(repo: Path, target: str) -> dict[str, object]:
    """Advance an existing merge only after a complete three-way patch succeeds."""
    previous = resolve_commit(repo, "MERGE_HEAD")
    run_git(repo, ["merge-base", "--is-ancestor", previous, target])
    if run_git(repo, ["diff", "--name-only", "--diff-filter=U"]).stdout:
        raise GitCommandError("Resolve the existing conflicts before advancing")
    if run_git(repo, ["diff", "--quiet", "--"], check=False).returncode:
        raise GitCommandError("Stage the reviewed worktree before advancing")
    if previous == target:
        return {"from": previous, "to": target, "returncode": 0}

    # Keep raw bytes: official grammar updates may contain Git binary patches,
    # and decoding/re-encoding a source diff could corrupt a non-UTF-8 file.
    patch = subprocess.run(
        ["git", "-C", str(repo), "diff", "--binary", "--full-index", previous, target],
        check=False,
        capture_output=True,
    )
    if patch.returncode:
        raise GitCommandError(patch.stderr.decode("utf-8", errors="replace"))
    command = ["git", "-C", str(repo), "apply", "--3way", "--index"]
    pending = Path(
        run_git(
            repo, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]
        ).stdout.strip()
    )
    lock = pending.with_name(pending.name + ".lock")
    owned_lock = False
    try:
        # MERGE_HEAD is a Git pseudoref, which update-ref refuses to write.
        # Lock and replace that generated merge-state file atomically instead;
        # never remove a pre-existing lock belonging to another Git operation.
        with lock.open("x", encoding="ascii", newline="\n") as handle:
            owned_lock = True
            if resolve_commit(repo, "MERGE_HEAD") != previous:
                raise GitCommandError("The pending merge changed during planning")
            applied = subprocess.run(
                command, input=patch.stdout, check=False, capture_output=True
            )
            if applied.returncode == 0:
                handle.write(target + "\n")
                handle.flush()
                os.fsync(handle.fileno())
        if applied.returncode == 0:
            lock.replace(pending)
    finally:
        if owned_lock:
            lock.unlink(missing_ok=True)
    result = CommandResult(
        args=command,
        returncode=applied.returncode,
        stdout=applied.stdout.decode("utf-8", errors="replace"),
        stderr=applied.stderr.decode("utf-8", errors="replace"),
    )
    if applied.returncode == 0:
        # HEAD and the branch remain uncommitted; keep Git's proposed message
        # consistent with the pending parent only after the full patch succeeds.
        message = Path(
            run_git(
                repo, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_MSG"]
            ).stdout.strip()
        )
        if message.is_file():
            message.write_text(
                message.read_text(encoding="utf-8").replace(previous, target),
                encoding="utf-8",
            )
    return {"from": previous, "to": target, **asdict(result)}


def verify_merge(repo: Path, plan: dict[str, object]) -> dict[str, object]:
    """Check integration state without committing or changing the worktree.

    File preservation is only a structural guard; the fork's API, CLI and
    telemetry regression suites remain the behavioral acceptance gate.
    """
    target = str(plan["upstream"])
    pending = run_git(repo, ["rev-parse", "--verify", "MERGE_HEAD"], check=False)
    if pending.returncode == 0:
        target_integrated = pending.stdout.strip() == target
    else:
        target_integrated = (
            run_git(
                repo, ["merge-base", "--is-ancestor", target, "HEAD"], check=False
            ).returncode
            == 0
        )
    unmerged = run_git(
        repo, ["diff", "--name-only", "--diff-filter=U"]
    ).stdout.splitlines()
    # A fork-exclusive deletion is intentional. Protect only paths still
    # tracked in the fork's HEAD, using Git's path representation, not globs.
    exclusive = plan["fork_exclusive_paths"]
    assert isinstance(exclusive, list)
    missing = [
        relative
        for relative in exclusive
        if run_git(repo, ["ls-tree", "HEAD", "--", relative]).stdout
        and not (repo / relative).exists()
    ]
    # Check the fork's integration delta, not unchanged official files: grammar
    # patch files intentionally carry space-prefixed empty context lines.
    whitespace = run_git(
        repo,
        [
            "-c",
            "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol",
            "diff",
            "--check",
            target,
            "--",
        ],
        check=False,
    )
    return {
        "target_integrated": target_integrated,
        "unmerged_paths": unmerged,
        "missing_fork_paths": missing,
        "diff_check": asdict(whitespace),
        "ok": target_integrated
        and not unmerged
        and not missing
        and whitespace.returncode == 0,
    }


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
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument(
        "--apply",
        action="store_true",
        help="start git merge --no-ff --no-commit after writing the plan",
    )
    actions.add_argument(
        "--verify",
        action="store_true",
        help="verify the pending or completed merge without committing it",
    )
    actions.add_argument(
        "--advance",
        action="store_true",
        help="advance a fully staged pending merge to a descendant upstream commit",
    )
    parser.add_argument(
        "--fetch",
        action="store_true",
        help="fetch the configured upstream remote's main branch before planning",
    )
    parser.add_argument(
        "--report",
        help="optional JSON report path; defaults to stdout",
    )
    args = parser.parse_args()

    try:
        repo = resolve_repo(args.repo)
        if args.fetch:
            run_git(repo, ["fetch", "upstream", "main"])
        plan = build_plan(repo, args.upstream_ref)
        if args.apply:
            require_clean_worktree(repo)
            merge = run_git(
                repo,
                ["merge", "--no-ff", "--no-commit", str(plan["upstream"])],
                check=False,
            )
            plan["apply"] = asdict(merge)
            plan["post_merge_status"] = run_git(
                repo, ["status", "--short"]
            ).stdout.splitlines()
        if args.verify:
            plan["verification"] = verify_merge(repo, plan)
        if args.advance:
            plan["advance"] = advance_merge(repo, str(plan["upstream"]))
        write_report(plan, args.report)
        if args.advance:
            return 0 if plan["advance"]["returncode"] == 0 else 1
        if args.verify:
            return 0 if plan["verification"]["ok"] else 1
        return 0 if not args.apply or plan["apply"]["returncode"] == 0 else 1
    except (GitCommandError, OSError, ValueError) as error:
        logging.error("%s", error)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
