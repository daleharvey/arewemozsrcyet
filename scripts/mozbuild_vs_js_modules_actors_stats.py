# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from mozbuild.base import MozbuildObject
from mozversioncontrol import get_repository_from_env
import logging
import json

_log = logging.getLogger(__name__)


def extract_info_from_mozbuild():
    repo = get_repository_from_env()
    paths = [p for [p, _] in repo.get_tracked_files_finder().find("**/moz.build")]
    mbo = MozbuildObject.from_environment()
    reader = mbo.mozbuild_reader(config_mode="empty")
    counts = dict()
    for mozbuild_path in paths:
        if mozbuild_path.startswith("python/mozbuild/") or mozbuild_path.startswith(
            "third_party"
        ):
            continue
        for var in ["EXTRA_JS_MODULES", "EXTRA_PP_JS_MODULES", "MOZ_SRC_FILES"]:
            mods = reader.find_variables_from_ast(
                variables=var,
                path=mozbuild_path,
                all_relevant_files=False,
            )
            for path, _variable, key, value in mods:
                counts[var] = counts.get(var, 0) + 1

        if (
            mozbuild_path.startswith("build/")
            or mozbuild_path.startswith("dom/webgpu/")
            or mozbuild_path == "intl/locales/moz.build"
            or mozbuild_path == "mobile/android/app/moz.build"
            or mozbuild_path == "modules/libpref/moz.build"
            or mozbuild_path == "testing/specialpowers/moz.build"
            or mozbuild_path == "toolkit/components/ml/moz.build"
        ):
            # These have dynamic (non-constant) values for some stuff and this
            # upsets the AST parsing.
            continue
        try:
            actors = reader.find_variables_from_ast(
                variables="FINAL_TARGET_FILES",
                path=mozbuild_path,
                all_relevant_files=False,
            )
            for path, _variable, key, value in actors:
                if key == "actors":
                    counts["ACTORS"] = counts.get("ACTORS", 0) + 1
        except AssertionError:
            _log.error(f"Skipping moz.build with AST issues: {mozbuild_path}")
    return counts


if __name__ == "__main__":
    info = extract_info_from_mozbuild()
    for key, count in info.items():
        _log.log(logging.INFO, f"{key}: {count}")
    rev = get_repository_from_env().base_ref_as_commit()
    info["revision"] = rev
    info["commit_date"] = get_repository_from_env().get_commit_time()
    print(json.dumps(info))
